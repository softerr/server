<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/lib/smtp.php';

function sendVerificationEmail(string $email, string $username, string $token, string $expires, ?string $userTimezone = null): bool
{
    $baseUrl = appBaseUrl();
    if ($baseUrl === null) {
        return false;
    }

    $formattedExpires = $expires;
    try {
        $trimmedExpires = trim($expires);
        if (preg_match('/(Z|[+-]\d{2}(:?\d{2})?|[A-Za-z_\/]+)$/', $trimmedExpires) === 1) {
            $expiresAt = new DateTimeImmutable($trimmedExpires);
        } else {
            // PostgreSQL text value without timezone is treated as UTC.
            $expiresAt = new DateTimeImmutable($trimmedExpires, new DateTimeZone('UTC'));
        }

        $timezoneName = trim((string)($userTimezone ?? ''));
        if ($timezoneName !== '') {
            try {
                $expiresAt = $expiresAt->setTimezone(new DateTimeZone($timezoneName));
            } catch (Exception $e) {
                // Ignore invalid timezone and keep parsed timezone.
            }
        }
        $formattedExpires = $expiresAt->format('Y-m-d H:i:s T');
    } catch (Exception $e) {
        // Keep original value when parsing fails.
    }

    $verifyUrl = $baseUrl . '/api/auth/verify?token=' . rawurlencode($token) . '&view=html';
    $subject = 'Verify your account';
    $body = "Hello {$username},\n\n"
        . "Please verify your account by opening this link:\n"
        . "{$verifyUrl}\n\n"
        . "This link expires at: {$formattedExpires}\n";

    $mailFrom = trim((string)(getenv('MAIL_FROM') ?: 'no-reply@localhost'));
    if (trim((string)(getenv('SMTP_HOST') ?: '')) !== '') {
        return sendViaSmtp($email, $subject, $body, $mailFrom);
    }

    if (!function_exists('mail')) {
        error_log('PHP mail() is unavailable and SMTP_HOST is not configured');
        return false;
    }

    $headers = [
        "From: {$mailFrom}",
        'Content-Type: text/plain; charset=UTF-8',
    ];

    $accepted = mail($email, $subject, $body, implode("\r\n", $headers));
    if (!$accepted) {
        error_log('PHP mail() failed to accept verification email');
    }
    return $accepted;
}
