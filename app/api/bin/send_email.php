<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require_once __DIR__ . '/../mail.php';
require_once __DIR__ . '/../lib/db.php';

$password = (string)(getenv('DB_PASSWORD') ?: '');
if ($password === '' || !function_exists('pg_connect')) {
    fwrite(STDERR, "Email worker requires DB_PASSWORD and php-pgsql.\n");
    exit(1);
}

[$db] = openDb(5);
if ($db === false) {
    fwrite(STDERR, "Email worker could not connect to PostgreSQL.\n");
    exit(1);
}

$failed = false;
for ($processed = 0; $processed < 20; $processed++) {
    // The claim expires if this process dies; available_at remains the send schedule.
    $result = @pg_query($db, 'WITH next_job AS (
            SELECT o.id, o.token_id, o.timezone, u.username, u.email,
                   t.type, t.hash, t.expires
            FROM public.verification_email_outbox o
            JOIN public.user_token t ON t.id = o.token_id
            JOIN public."user" u ON u.id = t.user_id
            WHERE o.available_at <= CURRENT_TIMESTAMP
              AND u.deleting = FALSE
              AND (o.claimed_until IS NULL OR o.claimed_until <= CURRENT_TIMESTAMP)
              AND t.expires > CURRENT_TIMESTAMP
              AND ((t.type = \'verify\' AND u.verified = FALSE)
                   OR (t.type IN (\'password_reset\', \'password_changed\')
                       AND u.verified = TRUE))
            ORDER BY o.available_at, o.id
            LIMIT 1
            FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE public.verification_email_outbox o
        SET claimed_until = CURRENT_TIMESTAMP + INTERVAL \'15 minutes\',
            claim_id = gen_random_uuid()
        FROM next_job
        WHERE o.id = next_job.id
        RETURNING o.id, o.token_id, o.claim_id,
                  next_job.timezone, next_job.username, next_job.email,
                  next_job.type, next_job.hash, next_job.expires');
    if ($result === false) {
        fwrite(STDERR, "Email worker could not fetch queued mail.\n");
        exit(1);
    }

    $job = pg_fetch_assoc($result);
    if ($job === false) {
        break;
    }

    if ($job['type'] === 'password_reset') {
        $rawToken = random_bytes(32);
        $token = bin2hex($rawToken);
        $digest = hash('sha256', $rawToken);
        $stored = @pg_query_params($db,
            'UPDATE public.user_token t SET hash = $1
             FROM public.verification_email_outbox o
             WHERE t.id = $2 AND o.token_id = t.id AND o.id = $3
               AND o.claim_id = $4::uuid AND t.type = $5
               AND t.expires > CURRENT_TIMESTAMP
             RETURNING t.id',
            [$digest, $job['token_id'], $job['id'], $job['claim_id'], 'password_reset']);
        if ($stored === false) {
            fwrite(STDERR, "Email worker could not prepare reset token.\n");
            exit(1);
        }
        if (pg_fetch_assoc($stored) === false) {
            @pg_query_params($db,
                'DELETE FROM public.verification_email_outbox
                 WHERE id = $1 AND claim_id = $2::uuid',
                [$job['id'], $job['claim_id']]);
            continue;
        }
        $sent = sendPasswordResetEmail($job['email'], $job['username'], $token);
    } elseif ($job['type'] === 'password_changed') {
        $sent = sendPasswordChangedEmail($job['email'], $job['username']);
    } else {
        $sent = sendVerificationEmail(
            $job['email'], $job['username'], $job['hash'],
            $job['expires'], $job['timezone']
        );
    }

    if ($sent) {
        if ($job['type'] === 'password_changed') {
            $saved = @pg_query_params($db,
                'DELETE FROM public.user_token t
                 USING public.verification_email_outbox o
                 WHERE t.id = o.token_id AND o.id = $1 AND o.claim_id = $2::uuid
                   AND t.type = $3',
                [$job['id'], $job['claim_id'], 'password_changed']);
        } else {
            $saved = @pg_query_params($db,
                'DELETE FROM public.verification_email_outbox
                 WHERE id = $1 AND claim_id = $2::uuid',
                [$job['id'], $job['claim_id']]);
        }
    } else {
        $failed = true;
        $saved = @pg_query_params($db,
            'UPDATE public.verification_email_outbox
             SET attempts = attempts + 1,
                 available_at = CURRENT_TIMESTAMP + INTERVAL \'2 minutes\',
                 claimed_until = NULL,
                 claim_id = NULL
             WHERE id = $1 AND claim_id = $2::uuid',
            [$job['id'], $job['claim_id']]);
        error_log('Account email delivery failed for outbox job ' . $job['id']);
    }
    if ($saved === false) {
        fwrite(STDERR, "Email worker could not save delivery outcome.\n");
        exit(1);
    }
}

// Remove jobs that no longer need delivery or whose recipient is no longer an
// active admin. Approval itself also removes pending jobs for that applicant.
$pruned = @pg_query($db, 'DELETE FROM public.approval_email_outbox o
    WHERE NOT EXISTS (SELECT 1 FROM public."user" applicant
                      WHERE applicant.id = o.applicant_id AND applicant.verified = TRUE
                        AND applicant.approved_at IS NULL AND applicant.deleting = FALSE)
       OR NOT EXISTS (SELECT 1 FROM public."user" admin
                      WHERE admin.id = o.recipient_id AND admin.role = \'admin\'
                        AND admin.verified = TRUE AND admin.approved_at IS NOT NULL
                        AND admin.deleting = FALSE)');
if ($pruned === false) {
    fwrite(STDERR, "Email worker could not prune approval mail.\n");
    exit(1);
}

for ($processed = 0; $processed < 20; $processed++) {
    $result = @pg_query($db, 'WITH next_job AS (
            SELECT o.id, applicant.username AS applicant_name,
                   applicant.email AS applicant_email,
                   admin.username AS admin_name, admin.email AS admin_email
            FROM public.approval_email_outbox o
            JOIN public."user" applicant ON applicant.id = o.applicant_id
            JOIN public."user" admin ON admin.id = o.recipient_id
            WHERE o.available_at <= CURRENT_TIMESTAMP
              AND (o.claimed_until IS NULL OR o.claimed_until <= CURRENT_TIMESTAMP)
              AND applicant.verified = TRUE AND applicant.approved_at IS NULL
              AND applicant.deleting = FALSE
              AND admin.role = \'admin\' AND admin.verified = TRUE
              AND admin.approved_at IS NOT NULL AND admin.deleting = FALSE
            ORDER BY o.available_at, o.id
            LIMIT 1 FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE public.approval_email_outbox o
        SET claimed_until = CURRENT_TIMESTAMP + INTERVAL \'15 minutes\',
            claim_id = gen_random_uuid()
        FROM next_job WHERE o.id = next_job.id
        RETURNING o.id, o.claim_id, next_job.applicant_name,
                  next_job.applicant_email, next_job.admin_name, next_job.admin_email');
    if ($result === false) {
        fwrite(STDERR, "Email worker could not fetch approval mail.\n");
        exit(1);
    }
    $job = pg_fetch_assoc($result);
    if ($job === false) {
        break;
    }

    $sent = sendApprovalRequestEmail($job['admin_email'], $job['admin_name'],
        $job['applicant_name'], $job['applicant_email']);
    if ($sent) {
        $saved = @pg_query_params($db,
            'DELETE FROM public.approval_email_outbox WHERE id = $1 AND claim_id = $2::uuid',
            [$job['id'], $job['claim_id']]);
    } else {
        $failed = true;
        $saved = @pg_query_params($db,
            'UPDATE public.approval_email_outbox
             SET attempts = attempts + 1,
                 available_at = CURRENT_TIMESTAMP + INTERVAL \'2 minutes\',
                 claimed_until = NULL, claim_id = NULL
             WHERE id = $1 AND claim_id = $2::uuid',
            [$job['id'], $job['claim_id']]);
        error_log('Approval email delivery failed for outbox job ' . $job['id']);
    }
    if ($saved === false) {
        fwrite(STDERR, "Email worker could not save approval delivery outcome.\n");
        exit(1);
    }
}

exit($failed ? 1 : 0);
