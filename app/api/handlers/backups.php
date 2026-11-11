<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/backup_zip_stream.php';

const BACKUP_MEGA_DIRECTORY = '/softerr-backups';
const BACKUP_MEGA_HOME = '/var/lib/softerr-mega';
const BACKUP_APP_REGISTRY = '/etc/softerr/apps.tsv';
const BACKUP_DOWNLOAD_HEADROOM_BYTES = 512 * 1024 * 1024;

function requireBackupDownloadSpace(string $directory, float $needed): void
{
    $available = @disk_free_space($directory);
    if ($available === false) {
        error_log('Could not check temporary disk space for backup download');
        respond(503, ['error' => 'Backup download is unavailable']);
    }
    if ($available < $needed) {
        respond(503, ['error' => 'Not enough temporary disk space to prepare backup download']);
    }
}

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

function backupArtifacts(): array
{
    return [...array_fill_keys(backupDatabases(), 'dump'), 'media-files' => 'tar'];
}

function authorizeBackupDownload(): void
{
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    $user = currentSessionUser();
    if ($user['role'] !== 'admin') respond(403, ['error' => 'Admin access required']);
}

function runBackupMegaCommand(array $command): string
{
    $executable = '/usr/local/bin/' . $command[0];
    if (!is_executable($executable)) $executable = '/usr/bin/' . $command[0];
    if (!is_executable($executable)) {
        error_log('MEGA backup command is missing: ' . $command[0]);
        throw new RuntimeException('Backup storage is unavailable');
    }
    $command[0] = $executable;
    $output = tempnam(sys_get_temp_dir(), 'mega-output-');
    $errors = tempnam(sys_get_temp_dir(), 'mega-errors-');
    if ($output === false || $errors === false) {
        if ($output !== false) @unlink($output);
        if ($errors !== false) @unlink($errors);
        error_log('Could not create temporary MEGA command output files');
        throw new RuntimeException('Backup storage is unavailable');
    }
    try {
        $process = @proc_open($command, [0 => ['file', '/dev/null', 'r'],
            1 => ['file', $output, 'w'], 2 => ['file', $errors, 'w']], $pipes, null,
            ['HOME' => BACKUP_MEGA_HOME, 'PATH' => '/usr/local/bin:/usr/bin:/bin']);
        if (!is_resource($process)) {
            error_log('Could not launch MEGA backup command: ' . $command[0]);
            throw new RuntimeException('Backup storage is unavailable');
        }
        $status = proc_close($process);
        if ($status !== 0) {
            error_log('MEGA backup command failed: ' . implode(' ', array_slice($command, 0, 2)) . ': ' . substr((string) file_get_contents($errors), 0, 500));
            throw new RuntimeException('Backup storage is unavailable');
        }
        $result = file_get_contents($output);
        if ($result === false) throw new RuntimeException('Backup storage is unavailable');
        return $result;
    } finally {
        @unlink($output);
        @unlink($errors);
    }
}

function backupMegaCommand(array $command): string
{
    try {
        return runBackupMegaCommand($command);
    } catch (RuntimeException $error) {
        respond(503, ['error' => 'Backup storage is unavailable']);
    }
}

function downloadBackupArtifact(array $file, string $directory): string
{
    runBackupMegaCommand(['mega-get', BACKUP_MEGA_DIRECTORY . '/' . $file['name'], $directory]);
    $path = $directory . '/' . $file['name'];
    clearstatcache(true, $path);
    if (!is_file($path) || filesize($path) !== $file['size']) {
        throw new RuntimeException('Backup archive size does not match the MEGA listing');
    }
    return $path;
}

function availableBackupSets(): array
{
    $artifacts = backupArtifacts();
    $artifactPattern = implode('|', array_map(static fn (string $name): string => preg_quote($name, '/'), array_keys($artifacts)));
    $listing = backupMegaCommand(['mega-ls', '-l', BACKUP_MEGA_DIRECTORY]);
    $candidates = [];
    foreach (preg_split('/\r?\n/', $listing) as $line) {
        $fields = preg_split('/\s+/', trim($line));
        if (count($fields) < 5 || !ctype_digit($fields[2])) continue;
        $name = end($fields);
        if (!preg_match('/^(' . $artifactPattern . ')-(\d{8}T\d{6}Z)\.[A-Za-z0-9]{8}\.(dump|tar)$/D', $name, $match)
            || $artifacts[$match[1]] !== $match[3]) continue;
        $candidates[$match[2]][$match[1]][] = ['name' => $name, 'size' => (int) $fields[2]];
    }
    krsort($candidates, SORT_STRING);
    $sets = [];
    foreach ($candidates as $stamp => $databases) {
        $files = [];
        foreach ($artifacts as $artifact => $_) {
            if (count($databases[$artifact] ?? []) !== 1) continue 2;
            $files[$artifact] = $databases[$artifact][0];
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
    $entries = [];
    $largestFile = 0;
    foreach (backupArtifacts() as $artifact => $extension) {
        $file = $files[$artifact];
        if ($file['size'] < 1) respond(503, ['error' => 'Backup archive is unavailable']);
        $entries[$artifact . '.' . $extension] = $file['size'];
        $largestFile = max($largestFile, $file['size']);
    }
    try {
        $length = BackupZipStream::expectedLength($entries);
    } catch (OverflowException $error) {
        respond(503, ['error' => 'Backup archive is too large']);
    }
    // Only the current archive is staged; the ZIP goes directly to the client.
    requireBackupDownloadSpace(sys_get_temp_dir(), $largestFile + BACKUP_DOWNLOAD_HEADROOM_BYTES);
    set_time_limit(0);
    $directory = sys_get_temp_dir() . '/softerr-backup-' . bin2hex(random_bytes(12));
    if (!@mkdir($directory, 0700)) respond(500, ['error' => 'Could not prepare backup download']);
    register_shutdown_function(static function () use ($directory): void {
        $files = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($files as $file) {
            if ($file->isDir() && !$file->isLink()) @rmdir($file->getPathname());
            else @unlink($file->getPathname());
        }
        @rmdir($directory);
    });
    $firstArtifact = array_key_first($files);
    try {
        $firstPath = downloadBackupArtifact($files[$firstArtifact], $directory);
    } catch (RuntimeException $error) {
        error_log('Could not begin backup download: ' . $error->getMessage());
        respond(503, ['error' => 'Backup archive is unavailable']);
    }
    $output = @fopen('php://output', 'wb');
    if ($output === false) respond(500, ['error' => 'Could not prepare backup download']);
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="softerr-backup-' . $stamp . '.zip"');
    header('Content-Length: ' . $length);
    header('X-Accel-Buffering: no');
    try {
        $zip = new BackupZipStream($output);
        foreach (backupArtifacts() as $artifact => $extension) {
            $file = $files[$artifact];
            $path = $artifact === $firstArtifact ? $firstPath : downloadBackupArtifact($file, $directory);
            $zip->addFile($path, $artifact . '.' . $extension, $file['size']);
            if (!@unlink($path)) throw new RuntimeException('Could not remove temporary backup archive');
        }
        $zip->finish();
    } catch (Throwable $error) {
        // Once the response starts, Content-Length makes an incomplete ZIP
        // fail at the client instead of presenting a partial backup as valid.
        error_log('Backup ZIP stream failed: ' . $error->getMessage());
    } finally {
        fclose($output);
    }
    exit;
}
