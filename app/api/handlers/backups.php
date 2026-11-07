<?php
declare(strict_types=1);

const BACKUP_MEGA_DIRECTORY = '/softerr-backups';
const BACKUP_MEGA_HOME = '/var/lib/softerr-mega';
const BACKUP_APP_REGISTRY = '/etc/softerr/apps.tsv';

function backupDatabases(): array
{
    $lines = @file(BACKUP_APP_REGISTRY, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) respond(503, ['error' => 'Backup configuration is unavailable']);
    $databases = ['auth', 'media'];
    foreach ($lines as $line) {
        if (str_starts_with($line, '#')) continue;
        $fields = explode('|', $line);
        if (count($fields) !== 10) respond(503, ['error' => 'Backup configuration is invalid']);
        $database = $fields[5];
        if ($database === '') continue;
        if (!preg_match('/^[a-z][a-z0-9_]*$/D', $database) || in_array($database, $databases, true)) {
            respond(503, ['error' => 'Backup configuration is invalid']);
        }
        $databases[] = $database;
    }
    return $databases;
}

function authorizeBackupDownload(): void
{
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    $user = currentSessionUser();
    if ($user['role'] !== 'admin') respond(403, ['error' => 'Admin access required']);
}

function backupMegaCommand(array $command): string
{
    $output = tempnam(sys_get_temp_dir(), 'mega-output-');
    $errors = tempnam(sys_get_temp_dir(), 'mega-errors-');
    if ($output === false || $errors === false) respond(503, ['error' => 'Backup storage is unavailable']);
    try {
        $process = @proc_open($command, [0 => ['file', '/dev/null', 'r'],
            1 => ['file', $output, 'w'], 2 => ['file', $errors, 'w']], $pipes, null,
            ['HOME' => BACKUP_MEGA_HOME, 'PATH' => '/usr/local/bin:/usr/bin:/bin']);
        if (!is_resource($process)) respond(503, ['error' => 'Backup storage is unavailable']);
        $status = proc_close($process);
        if ($status !== 0) {
            error_log('MEGA backup command failed: ' . implode(' ', array_slice($command, 0, 2)) . ': ' . substr((string) file_get_contents($errors), 0, 500));
            respond(503, ['error' => 'Backup storage is unavailable']);
        }
        return (string) file_get_contents($output);
    } finally {
        @unlink($output);
        @unlink($errors);
    }
}

function availableBackupSets(): array
{
    $backupDatabases = backupDatabases();
    $databasePattern = implode('|', array_map(static fn (string $name): string => preg_quote($name, '/'), $backupDatabases));
    $listing = backupMegaCommand(['mega-ls', '-l', BACKUP_MEGA_DIRECTORY]);
    $candidates = [];
    foreach (preg_split('/\r?\n/', $listing) as $line) {
        $fields = preg_split('/\s+/', trim($line));
        if (count($fields) < 5 || !ctype_digit($fields[2])) continue;
        $name = end($fields);
        if (!preg_match('/^(' . $databasePattern . ')-(\d{8}T\d{6}Z)\.[A-Za-z0-9]{8}\.dump$/D', $name, $match)) continue;
        $candidates[$match[2]][$match[1]][] = ['name' => $name, 'size' => (int) $fields[2]];
    }
    krsort($candidates, SORT_STRING);
    $sets = [];
    foreach ($candidates as $stamp => $databases) {
        $files = [];
        foreach ($backupDatabases as $database) {
            if (count($databases[$database] ?? []) !== 1) continue 2;
            $files[$database] = $databases[$database][0];
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
        foreach ($files as $file) $size += $file['size'];
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
    $directory = sys_get_temp_dir() . '/softerr-backup-' . bin2hex(random_bytes(12));
    if (!@mkdir($directory, 0700)) respond(500, ['error' => 'Could not prepare backup download']);
    $path = $directory . '/backup.zip';
    register_shutdown_function(static function () use ($directory): void {
        foreach (glob($directory . '/*') ?: [] as $file) @unlink($file);
        @rmdir($directory);
    });
    foreach ($files as $file) {
        backupMegaCommand(['mega-get', BACKUP_MEGA_DIRECTORY . '/' . $file['name'], $directory]);
        $download = $directory . '/' . $file['name'];
        clearstatcache(true, $download);
        if (!is_file($download) || filesize($download) !== $file['size']) {
            respond(503, ['error' => 'Backup archive is unavailable']);
        }
    }
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        respond(500, ['error' => 'Could not prepare backup download']);
    }
    foreach (backupDatabases() as $database) {
        $name = $database . '.dump';
        if (!$zip->addFile($directory . '/' . $files[$database]['name'], $name)
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
