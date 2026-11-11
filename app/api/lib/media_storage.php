<?php
declare(strict_types=1);

const MEDIA_STORAGE_ROOT = '/var/lib/softerr/media';

function mediaStoragePath(string $kind, string $hash): string
{
    $hash = strtolower(trim($hash));
    if (!in_array($kind, ['images', 'thumbnails', 'audio'], true)
        || preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1) {
        throw new InvalidArgumentException('Invalid media storage key');
    }
    return MEDIA_STORAGE_ROOT . "/{$kind}/" . substr($hash, 0, 2) . "/{$hash}";
}

function mediaStorageWrite(string $kind, string $hash, string $bytes): void
{
    $path = mediaStoragePath($kind, $hash);
    $directory = dirname($path);
    if (!is_dir($directory)) {
        if (!@mkdir($directory, 02770, true) && !is_dir($directory)) {
            throw new RuntimeException('Could not create media storage directory');
        }
        @chmod($directory, 02770);
    }
    if (is_file($path)) {
        if (hash_file('sha256', $path) !== hash('sha256', $bytes)) {
            throw new RuntimeException('Stored media bytes differ from the expected file');
        }
        return;
    }
    $temporary = @tempnam($directory, '.upload-');
    if ($temporary === false) throw new RuntimeException('Could not stage media file');
    try {
        if (@file_put_contents($temporary, $bytes) !== strlen($bytes)) {
            throw new RuntimeException('Could not save media file');
        }
        $stream = @fopen($temporary, 'c+b');
        if ($stream === false) throw new RuntimeException('Could not sync media file');
        try {
            if (!@fsync($stream)) throw new RuntimeException('Could not sync media file');
        } finally {
            fclose($stream);
        }
        if (!@chmod($temporary, 0640)
            || (!@link($temporary, $path) && !is_file($path))) {
            throw new RuntimeException('Could not save media file');
        }
        if (hash_file('sha256', $path) !== hash('sha256', $bytes)) {
            throw new RuntimeException('Stored media bytes differ from the expected file');
        }
    } finally {
        @unlink($temporary);
    }
}

function mediaStorageRead(string $kind, string $hash): string
{
    $bytes = @file_get_contents(mediaStoragePath($kind, $hash));
    if ($bytes === false) throw new RuntimeException('Media file is missing');
    return $bytes;
}
