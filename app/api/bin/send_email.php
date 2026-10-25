<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require_once __DIR__ . '/../mail.php';

$password = (string)(getenv('DB_PASSWORD') ?: '');
if ($password === '' || !function_exists('pg_connect')) {
    fwrite(STDERR, "Email worker requires DB_PASSWORD and php-pgsql.\n");
    exit(1);
}

$connection = sprintf(
    'host=%s port=%s dbname=%s user=%s password=%s connect_timeout=5',
    quotePgConnectionValue((string)(getenv('DB_HOST') ?: '127.0.0.1')),
    quotePgConnectionValue((string)(getenv('DB_PORT') ?: '5432')),
    quotePgConnectionValue((string)(getenv('DB_NAME') ?: 'auth')),
    quotePgConnectionValue((string)(getenv('DB_USER') ?: 'auth_api')),
    quotePgConnectionValue($password)
);
$db = @pg_connect($connection);
if ($db === false) {
    fwrite(STDERR, "Email worker could not connect to PostgreSQL.\n");
    exit(1);
}

$failed = false;
for ($processed = 0; $processed < 20; $processed++) {
    // The claim expires if this process dies; available_at remains the send schedule.
    $result = @pg_query($db, 'WITH next_job AS (
            SELECT o.id, o.timezone, u.username, u.email, t.hash, t.expires
            FROM public.verification_email_outbox o
            JOIN public.user_token t ON t.id = o.token_id
            JOIN public."user" u ON u.id = t.user_id
            WHERE o.available_at <= CURRENT_TIMESTAMP
              AND (o.claimed_until IS NULL OR o.claimed_until <= CURRENT_TIMESTAMP)
              AND t.type = \'verify\'
              AND t.expires > CURRENT_TIMESTAMP
              AND u.verified = FALSE
            ORDER BY o.available_at, o.id
            LIMIT 1
            FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE public.verification_email_outbox o
        SET claimed_until = CURRENT_TIMESTAMP + INTERVAL \'15 minutes\',
            claim_id = gen_random_uuid()
        FROM next_job
        WHERE o.id = next_job.id
        RETURNING o.id, o.claim_id,
                  next_job.timezone, next_job.username, next_job.email,
                  next_job.hash, next_job.expires');
    if ($result === false) {
        fwrite(STDERR, "Email worker could not fetch queued mail.\n");
        exit(1);
    }

    $job = pg_fetch_assoc($result);
    if ($job === false) {
        break;
    }

    $sent = sendVerificationEmail(
        $job['email'],
        $job['username'],
        $job['hash'],
        $job['expires'],
        $job['timezone']
    );

    if ($sent) {
        $saved = @pg_query_params($db,
            'DELETE FROM public.verification_email_outbox
             WHERE id = $1 AND claim_id = $2::uuid',
            [$job['id'], $job['claim_id']]);
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
        error_log('Verification email delivery failed for outbox job ' . $job['id']);
    }
    if ($saved === false) {
        fwrite(STDERR, "Email worker could not save delivery outcome.\n");
        exit(1);
    }
}

exit($failed ? 1 : 0);
