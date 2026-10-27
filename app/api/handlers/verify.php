<?php
declare(strict_types=1);

function respondVerification(int $statusCode, array $payload): never
{
    header('Cache-Control: no-store');
    header('Vary: Accept');
    $accept = $_SERVER['HTTP_ACCEPT'] ?? '';
    $emailPage = ($_GET['view'] ?? null) === 'html';
    if (!$emailPage && (!str_contains($accept, 'text/html') || str_contains($accept, 'application/json'))) {
        respond($statusCode, $payload);
    }

    if ($statusCode === 200) {
        $title = 'Email verified';
        $message = 'Your account is ready. You can now log in.';
    } elseif ($statusCode === 400) {
        $title = 'Verification failed';
        $message = 'This verification link is invalid, expired, or already used.';
    } else {
        $title = 'Verification unavailable';
        $message = 'We could not verify your email right now. Please try again later.';
    }

    http_response_code($statusCode);
    header('Content-Type: text/html; charset=UTF-8');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'");
    $safeTitle = htmlspecialchars($title, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $safeMessage = htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    echo <<<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{$safeTitle}</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #121212; color: #e0e0e0; }
    main { box-sizing: border-box; width: min(32rem, calc(100% - 2rem)); padding: 2.5rem; border: 1px solid rgb(85 85 85 / 70%); background: #1e1e1e; }
    h1 { margin-top: 0; font-size: 2rem; }
    p { line-height: 1.6; color: #dddddd; }
    a { display: inline-block; margin-top: 1rem; padding: .75rem 1rem; border: 1px solid #d08b38; color: #d08b38; text-decoration: none; }
    a:hover, a:focus-visible { background: #555555; }
  </style>
</head>
<body>
  <main>
    <h1>{$safeTitle}</h1>
    <p>{$safeMessage}</p>
    <a href="/#login">Go to home</a>
  </main>
</body>
</html>
HTML;
    exit;
}

function handleVerify(): never
{
    $token = trim((string)($_GET['token'] ?? ''));
    if ($token === '' || !preg_match('/^[a-f0-9]{64}$/i', $token)) {
        respondVerification(400, ['error' => 'Invalid verification token']);
    }

    $db = connectDb();

    $lookupResult = @pg_query_params(
        $db,
        'SELECT id, user_id
         FROM public.user_token
         WHERE hash = $1
           AND type = $2
           AND expires > CURRENT_TIMESTAMP
         LIMIT 1',
        [$token, 'verify']
    );
    if ($lookupResult === false) {
        respondVerification(500, ['error' => 'Failed to validate verification token']);
    }

    $candidate = pg_fetch_assoc($lookupResult);
    if ($candidate === false) {
        respondVerification(400, ['error' => 'Verification token is invalid or expired']);
    }

    if (@pg_query($db, 'BEGIN') === false) {
        respondVerification(500, ['error' => 'Failed to start transaction']);
    }

    $accountLock = @pg_query_params(
        $db,
        'SELECT id FROM public."user" WHERE id = $1 AND deleting = FALSE FOR UPDATE',
        [$candidate['user_id']]
    );
    if ($accountLock === false) {
        @pg_query($db, 'ROLLBACK');
        respondVerification(500, ['error' => 'Failed to lock account for verification']);
    }
    if (pg_fetch_assoc($accountLock) === false) {
        @pg_query($db, 'ROLLBACK');
        respondVerification(400, ['error' => 'Verification token is invalid or expired']);
    }

    // Resend holds the same account lock before replacing tokens. Check again
    // after acquiring it, and lock the token against concurrent pruning.
    $tokenResult = @pg_query_params(
        $db,
        'SELECT id FROM public.user_token
         WHERE id = $1 AND user_id = $2 AND hash = $3
           AND type = $4 AND expires > clock_timestamp()
         FOR UPDATE',
        [$candidate['id'], $candidate['user_id'], $token, 'verify']
    );
    if ($tokenResult === false) {
        @pg_query($db, 'ROLLBACK');
        respondVerification(500, ['error' => 'Failed to validate verification token']);
    }
    if (pg_fetch_assoc($tokenResult) === false) {
        @pg_query($db, 'ROLLBACK');
        respondVerification(400, ['error' => 'Verification token is invalid or expired']);
    }

    $verifyResult = @pg_query_params(
        $db,
        'UPDATE public."user"
         SET verified = TRUE
         WHERE id = $1
         RETURNING id, username, email, role, verified, created',
        [$candidate['user_id']]
    );
    if ($verifyResult === false) {
        @pg_query($db, 'ROLLBACK');
        respondVerification(500, ['error' => 'Failed to verify account']);
    }

    $user = pg_fetch_assoc($verifyResult);
    if ($user === false) {
        @pg_query($db, 'ROLLBACK');
        respondVerification(500, ['error' => 'Failed to fetch verified account']);
    }

    $deleteResult = @pg_query_params(
        $db,
        'DELETE FROM public.user_token WHERE user_id = $1 AND type = $2',
        [$candidate['user_id'], 'verify']
    );
    if ($deleteResult === false) {
        @pg_query($db, 'ROLLBACK');
        respondVerification(500, ['error' => 'Failed to finalize verification']);
    }

    if (@pg_query($db, 'COMMIT') === false) {
        @pg_query($db, 'ROLLBACK');
        respondVerification(500, ['error' => 'Failed to commit verification']);
    }

    respondVerification(200, [
        'id' => (int)$user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'role' => $user['role'],
        'verified' => $user['verified'] === 't',
        'created' => $user['created'],
    ]);
}
