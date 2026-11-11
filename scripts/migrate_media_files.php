<?php
declare(strict_types=1);

$storageHelper = is_file(__DIR__ . '/media_storage.php')
    ? __DIR__ . '/media_storage.php' : __DIR__ . '/../app/api/lib/media_storage.php';
require_once $storageHelper;

if (PHP_SAPI !== 'cli' || !in_array($argv[1] ?? '', ['status', 'copy', 'finalize'], true)) {
    fwrite(STDERR, "Usage: php migrate_media_files.php status|copy|finalize\n");
    exit(1);
}

$db = @pg_connect('dbname=media');
if ($db === false) throw new RuntimeException('Could not connect to the media database');

function legacyColumn($db, string $table, string $column): bool
{
    $result = pg_query_params($db,
        'SELECT 1 FROM information_schema.columns
         WHERE table_schema = \'public\' AND table_name = $1 AND column_name = $2',
        [$table, $column]);
    return pg_num_rows($result) !== 0;
}

$legacyImages = legacyColumn($db, 'image_blob', 'content');
$legacyAudio = legacyColumn($db, 'audio_file', 'content');
if ($argv[1] === 'status') {
    echo ($legacyImages || $legacyAudio) ? "yes\n" : "no\n";
    exit(0);
}

function copyLegacyBytes($db, string $table, string $kind, int $batchSize): void
{
    if (!legacyColumn($db, $table, 'content')) return;
    $lastId = 0;
    $copied = 0;
    $logEvery = $kind === 'audio' ? 20 : 100;
    do {
        $thumbnail = $table === 'image_blob'
            ? ', thumbnail_content IS NOT NULL AS has_thumbnail' : '';
        $result = pg_query_params($db,
            "SELECT id, sha256, size_bytes{$thumbnail}
             FROM public.{$table} WHERE id > \$1 AND content IS NOT NULL
             ORDER BY id LIMIT \$2", [$lastId, $batchSize]);
        $count = 0;
        while (($row = pg_fetch_assoc($result)) !== false) {
            $lastId = (int) $row['id'];
            $count++;
            $hash = trim($row['sha256']);
            $path = mediaStoragePath($kind, $hash);
            if ($row['size_bytes'] === null && $table === 'image_blob') {
                $sizeResult = pg_query_params($db,
                    'UPDATE public.image_blob SET size_bytes = octet_length(content)
                     WHERE id = $1 RETURNING size_bytes', [$lastId]);
                if ($sizeResult === false || pg_num_rows($sizeResult) !== 1) {
                    throw new RuntimeException("Could not measure image blob {$lastId}");
                }
                $row['size_bytes'] = pg_fetch_result($sizeResult, 0, 0);
            }
            $thumbnailNeeded = $table === 'image_blob' && $row['has_thumbnail'] === 't'
                && !is_file(mediaStoragePath('thumbnails', $hash));
            if (is_file($path) && filesize($path) === (int) $row['size_bytes']
                && !$thumbnailNeeded) {
                continue;
            }
            $contentColumns = $table === 'image_blob'
                ? ", encode(thumbnail_content, 'base64') AS thumbnail" : '';
            $content = pg_query_params($db,
                "SELECT encode(content, 'base64') AS bytes{$contentColumns}
                 FROM public.{$table} WHERE id = \$1", [$lastId]);
            $stored = pg_fetch_assoc($content);
            if ($stored === false || $stored['bytes'] === null) continue;
            $bytes = base64_decode($stored['bytes'], true);
            if ($bytes === false || strlen($bytes) !== (int) $row['size_bytes']
                || hash('sha256', $bytes) !== $hash) {
                throw new RuntimeException("Corrupt {$table} row {$lastId}");
            }
            mediaStorageWrite($kind, $hash, $bytes);
            if ($table === 'image_blob' && $stored['thumbnail'] !== null) {
                $thumbnailBytes = base64_decode($stored['thumbnail'], true);
                if ($thumbnailBytes === false) throw new RuntimeException("Corrupt thumbnail {$lastId}");
                mediaStorageWrite('thumbnails', $hash, $thumbnailBytes);
            }
            $copied++;
            if ($copied % $logEvery === 0) echo "Copied {$copied} {$kind} files...\n";
        }
    } while ($count === $batchSize);
    echo "Copied {$copied} legacy {$kind} files.\n";
}

function verifyStoredFiles($db, string $table, string $kind): void
{
    $thumbnail = $table === 'image_blob' && legacyColumn($db, $table, 'thumbnail_content')
        ? ', thumbnail_content IS NOT NULL AS has_thumbnail' : '';
    $result = pg_query($db, "SELECT id, sha256, size_bytes{$thumbnail} FROM public.{$table} ORDER BY id");
    $checked = 0;
    while (($row = pg_fetch_assoc($result)) !== false) {
        $path = mediaStoragePath($kind, $row['sha256']);
        if ($row['size_bytes'] === null || !is_file($path)
            || filesize($path) !== (int) $row['size_bytes']
            || hash_file('sha256', $path) !== trim($row['sha256'])) {
            throw new RuntimeException("Missing {$kind} file for {$table} row {$row['id']}");
        }
        if ($table === 'image_blob' && ($row['has_thumbnail'] ?? 'f') === 't') {
            $thumbnailPath = mediaStoragePath('thumbnails', $row['sha256']);
            $original = pg_query_params($db,
                "SELECT encode(thumbnail_content, 'base64') FROM public.image_blob WHERE id = $1",
                [$row['id']]);
            $encoded = pg_fetch_result($original, 0, 0);
            $bytes = is_string($encoded) ? base64_decode($encoded, true) : false;
            if ($bytes === false || !is_file($thumbnailPath)
                || filesize($thumbnailPath) !== strlen($bytes)
                || hash_file('sha256', $thumbnailPath) !== hash('sha256', $bytes)) {
                throw new RuntimeException("Missing thumbnail for image blob {$row['id']}");
            }
        }
        $checked++;
    }
    echo "Verified {$checked} {$kind} files.\n";
}

if ($legacyImages) copyLegacyBytes($db, 'image_blob', 'images', 20);
if ($legacyAudio) copyLegacyBytes($db, 'audio_file', 'audio', 1);

if ($argv[1] === 'finalize') {
    if ($legacyImages) verifyStoredFiles($db, 'image_blob', 'images');
    if ($legacyAudio) verifyStoredFiles($db, 'audio_file', 'audio');
    if ($legacyImages) {
        if (@pg_query($db, 'BEGIN') === false
            || @pg_query($db, "SET LOCAL lock_timeout = '5s'") === false
            || @pg_query($db, 'ALTER TABLE public.image_blob ALTER COLUMN size_bytes SET NOT NULL') === false
            || @pg_query($db, 'ALTER TABLE public.image_blob DROP COLUMN content, DROP COLUMN thumbnail_content') === false
            || @pg_query($db, 'COMMIT') === false) {
            throw new RuntimeException('Could not remove legacy image bytes: ' . pg_last_error($db));
        }
    }
    if ($legacyAudio) {
        if (@pg_query($db, 'BEGIN') === false
            || @pg_query($db, "SET LOCAL lock_timeout = '5s'") === false
            || @pg_query($db, 'ALTER TABLE public.audio_file DROP COLUMN content') === false
            || @pg_query($db, 'COMMIT') === false) {
            throw new RuntimeException('Could not remove legacy audio bytes: ' . pg_last_error($db));
        }
    }
    echo "Legacy media byte columns removed.\n";
}
