<?php
declare(strict_types=1);

function musicoArtworkFilename(string $artist, string $album, string $title, string $mime, int $imageId): string
{
    $subject = trim($album) !== '' ? trim($album) : trim($title);
    $parts = array_values(array_filter([trim($artist), $subject], static fn (string $part): bool => $part !== ''));
    $base = implode(' - ', $parts);
    $base = trim((string) preg_replace('~[\x00-\x1F\x7F/\\\\]+~u', ' ', $base));
    $base = trim((string) preg_replace('/\s+/u', ' ', $base));
    if ($base === '') $base = 'Artwork ' . $imageId;
    $truncated = '';
    foreach (preg_split('//u', $base, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $character) {
        if (strlen($truncated . $character) > 240) break;
        $truncated .= $character;
    }
    $extension = match ($mime) {
        'image/png' => 'png',
        'image/webp' => 'webp',
        default => 'jpg',
    };
    return rtrim($truncated) . '.' . $extension;
}

function renameGenericMusicoArtwork($mediaDb, int $imageId, int $ownerId,
    string $artist, string $album, string $title): bool
{
    $result = @pg_query_params($mediaDb,
        'SELECT i.original_name, b.mime_type FROM public.image i
         JOIN public.image_blob b ON b.id = i.blob_id
         WHERE i.id = $1 AND i.owner_auth_user_id = $2 AND i.shared = FALSE
           AND lower(i.original_name) IN (\'album-art.png\', \'album-art.jpg\', \'album-art.jpeg\', \'album-art.webp\')',
        [$imageId, $ownerId]);
    if ($result === false) throw new RuntimeException('Could not check album artwork name');
    $row = pg_fetch_assoc($result);
    if ($row === false) return false;
    $name = musicoArtworkFilename($artist, $album, $title, $row['mime_type'], $imageId);
    $updated = @pg_query_params($mediaDb,
        'UPDATE public.image SET original_name = $1
         WHERE id = $2 AND owner_auth_user_id = $3 AND original_name = $4',
        [$name, $imageId, $ownerId, $row['original_name']]);
    if ($updated === false) throw new RuntimeException('Could not rename album artwork');
    return pg_affected_rows($updated) === 1;
}
