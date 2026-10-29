<?php
declare(strict_types=1);

const BACKUP_DIRECTORY = '/var/backups/softerr';
const BACKUP_DATABASES = ['auth', 'quiz', 'media'];

function authorizeBackupDownload(): void
{
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    $user = currentSessionUser();
    if ($user['role'] !== 'admin') respond(403, ['error' => 'Admin access required']);
}

function availableBackupSets(): array
{
    $names = @scandir(BACKUP_DIRECTORY);
    if ($names === false) respond(503, ['error' => 'Backup storage is unavailable']);
    $candidates = [];
    foreach ($names as $name) {
        if (!preg_match('/^(auth|quiz|media)-(\d{8}T\d{6}Z)\.[A-Za-z0-9]{8}\.dump$/D', $name, $match)) continue;
        $path = BACKUP_DIRECTORY . '/' . $name;
        if (is_link($path) || !is_file($path)) continue;
        $candidates[$match[2]][$match[1]][] = $path;
    }
    krsort($candidates, SORT_STRING);
    $sets = [];
    foreach ($candidates as $stamp => $databases) {
        $files = [];
        foreach (BACKUP_DATABASES as $database) {
            if (count($databases[$database] ?? []) !== 1) continue 2;
            $path = $databases[$database][0];
            if (!is_readable($path)) respond(503, ['error' => 'Backup archive is not readable']);
            $files[$database] = $path;
        }
        $sets[$stamp] = $files;
    }
    return $sets;
}

function handleListBackups(): never
{
    authorizeBackupDownload();
    $backups = [];
    foreach (availableBackupSets() as $stamp => $files) {
        $size = 0;
        foreach ($files as $path) {
            $bytes = @filesize($path);
            if ($bytes === false) respond(503, ['error' => 'Backup archive is unavailable']);
            $size += $bytes;
        }
        $backups[] = [
            'id' => $stamp,
            'created' => substr($stamp, 0, 4) . '-' . substr($stamp, 4, 2) . '-'
                . substr($stamp, 6, 2) . 'T' . substr($stamp, 9, 2) . ':'
                . substr($stamp, 11, 2) . ':' . substr($stamp, 13, 2) . 'Z',
            'size_bytes' => $size,
        ];
    }
    respond(200, ['backups' => $backups]);
}

function handleDownloadBackup(string $stamp): never
{
    authorizeBackupDownload();
    $files = availableBackupSets()[$stamp] ?? null;
    if ($files === null) respond(404, ['error' => 'Backup not found']);
    set_time_limit(0);
    $path = tempnam(sys_get_temp_dir(), 'softerr-backup-');
    if ($path === false) respond(500, ['error' => 'Could not prepare backup download']);
    register_shutdown_function(static fn () => @unlink($path));
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        respond(500, ['error' => 'Could not prepare backup download']);
    }
    foreach (BACKUP_DATABASES as $database) {
        $name = $database . '.dump';
        if (!$zip->addFile($files[$database], $name)
            || !$zip->setCompressionName($name, ZipArchive::CM_STORE)) {
            $zip->close();
            respond(500, ['error' => 'Could not prepare backup download']);
        }
    }
    if (!$zip->close()) respond(500, ['error' => 'Could not prepare backup download']);
    clearstatcache(true, $path);
    $size = filesize($path);
    if ($size === false) respond(500, ['error' => 'Could not prepare backup download']);

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="softerr-backup-' . $stamp . '.zip"');
    header('Content-Length: ' . $size);
    readfile($path);
    exit;
}
