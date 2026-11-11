<?php
declare(strict_types=1);

require_once __DIR__ . '/../../app/api/lib/backup_zip_stream.php';

$directory = sys_get_temp_dir() . '/softerr-zip-test-' . bin2hex(random_bytes(8));
if (!mkdir($directory, 0700)) throw new RuntimeException('Could not create ZIP test directory');
try {
    $contents = ['auth.dump' => "first\0archive", 'media-files.tar' => str_repeat('media bytes', 1000)];
    $sizes = [];
    foreach ($contents as $name => $bytes) {
        file_put_contents($directory . '/' . $name, $bytes);
        $sizes[$name] = strlen($bytes);
    }
    $output = fopen($directory . '/backup.zip', 'wb');
    if ($output === false) throw new RuntimeException('Could not open ZIP test output');
    try {
        $stream = new BackupZipStream($output);
        foreach ($sizes as $name => $size) $stream->addFile($directory . '/' . $name, $name, $size);
        $stream->finish();
    } finally {
        fclose($output);
    }
    if (filesize($directory . '/backup.zip') !== BackupZipStream::expectedLength($sizes)) {
        throw new RuntimeException('ZIP response length is incorrect');
    }
    $reader = new ZipArchive();
    if ($reader->open($directory . '/backup.zip') !== true) throw new RuntimeException('ZIP cannot be opened');
    try {
        if ($reader->numFiles !== count($contents)) throw new RuntimeException('ZIP entry count is incorrect');
        foreach ($contents as $name => $bytes) {
            if ($reader->getFromName($name) !== $bytes) throw new RuntimeException('ZIP content is incorrect');
        }
    } finally {
        $reader->close();
    }
    echo "Backup ZIP streaming check passed.\n";
} finally {
    foreach (glob($directory . '/*') ?: [] as $file) unlink($file);
    rmdir($directory);
}
