<?php
declare(strict_types=1);

const BACKUP_CAPTURE_LOCK = '/var/lib/softerr/backup-capture.lock';

// Hold the shared lock until PHP closes this request or worker process. An
// exclusive backup lock waits for active work and prevents new work from
// changing any of the databases while their dumps are captured.
function acquireBackupCaptureReadLock(): bool
{
    if (isset($GLOBALS['softerr_backup_capture_lock'])) return true;
    $handle = @fopen(BACKUP_CAPTURE_LOCK, 'rb');
    if ($handle === false) throw new RuntimeException('Backup capture lock is unavailable');
    if (!@flock($handle, LOCK_SH | LOCK_NB)) {
        fclose($handle);
        return false;
    }
    $GLOBALS['softerr_backup_capture_lock'] = $handle;
    return true;
}

function requireBackupCaptureReadLock(): void
{
    try {
        if (acquireBackupCaptureReadLock()) return;
    } catch (RuntimeException $error) {
        error_log($error->getMessage());
    }
    header('Retry-After: 30');
    respond(503, ['error' => 'Backup capture is in progress. Please retry shortly.']);
}
