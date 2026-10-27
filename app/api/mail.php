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

    return sendAccountEmail($email, $subject, $body);
}

function sendPasswordResetEmail(string $email, string $username, string $token): bool
{
    $baseUrl = appBaseUrl();
    if ($baseUrl === null) {
        return false;
    }
    $resetUrl = $baseUrl . '/#reset?token=' . rawurlencode($token);
    $body = "Hello {$username},\n\n"
        . "To reset your password, open this link:\n{$resetUrl}\n\n"
        . "This link expires 30 minutes after your request. If you did not request it, ignore this email.\n";
    return sendAccountEmail($email, 'Reset your password', $body);
}

function sendPasswordChangedEmail(string $email, string $username): bool
{
    $body = "Hello {$username},\n\n"
        . "Your account password was changed. If this was not you, reset it immediately.\n";
    return sendAccountEmail($email, 'Your password was changed', $body);
}

function sendApprovalRequestEmail(string $email, string $adminName, string $applicantName, string $applicantEmail): bool
{
    $baseUrl = appBaseUrl();
    if ($baseUrl === null) {
        return false;
    }
    $safeName = str_replace(["\r", "\n"], ' ', $applicantName);
    $body = "Hello {$adminName},\n\n"
        . "{$safeName} ({$applicantEmail}) verified their email and is waiting for account approval.\n\n"
        . "Review users: {$baseUrl}/#users\n";
    return sendAccountEmail($email, 'Account waiting for approval', $body);
}

function sendAccountEmail(string $email, string $subject, string $body): bool
{
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
        error_log('PHP mail() failed to accept account email');
    }
    return $accepted;
}
