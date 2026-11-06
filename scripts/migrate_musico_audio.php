<?php
declare(strict_types=1);

// Copy legacy Musico bytes into Media, then verify every track's Media link
// before the redundant audio columns are dropped. Safe to rerun.
require_once __DIR__ . '/../app/api/lib/db.php';

[$musico, $musicoError] = openMusicoDb();
[$media, $mediaError] = openMediaDb();
if ($musico === false || $media === false) {
    fwrite(STDERR, "Could not connect to Musico or Media: {$musicoError} {$mediaError}\n");
    exit(1);
}

$column = pg_query($musico, "SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'track' AND column_name = 'content'");
if ($column === false) exit(1);
$copied = 0;
if (pg_num_rows($column) !== 0) {
    $after = 0;
    while (true) {
        $result = @pg_query_params($musico,
            'SELECT t.id, u.auth_user_id, t.original_name, t.mime_type, t.size_bytes,
                    t.content_sha256, encode(t.content, \'base64\') AS encoded
             FROM public.track t JOIN public."user" u ON u.id = t.user_id
             WHERE t.id > $1 AND t.media_audio_id IS NULL ORDER BY t.id LIMIT 1', [$after]);
        if ($result === false) {
            fwrite(STDERR, "Could not read legacy audio\n");
            exit(1);
        }
        $track = pg_fetch_assoc($result);
        if ($track === false) break;
        $after = (int) $track['id'];
        $bytes = base64_decode($track['encoded'], true);
        if ($bytes === false || strlen($bytes) !== (int) $track['size_bytes']
            || !hash_equals(trim($track['content_sha256']), hash('sha256', $bytes))) {
            fwrite(STDERR, "Legacy audio failed integrity check for track {$after}\n");
            exit(1);
        }
        $owner = (int) $track['auth_user_id'];
        if (@pg_query($media, 'BEGIN') === false) exit(1);
        $insert = @pg_query_params($media,
            'INSERT INTO public.audio_file
                (owner_auth_user_id, original_name, mime_type, size_bytes, sha256, content)
             VALUES ($1, $2, $3, $4, $5, decode($6, \'base64\'))
             ON CONFLICT (owner_auth_user_id, sha256) DO NOTHING',
            [$owner, $track['original_name'], $track['mime_type'], $track['size_bytes'],
                trim($track['content_sha256']), $track['encoded']]);
        if ($insert === false) exit(1);
        $file = @pg_query_params($media,
            'SELECT id, mime_type, size_bytes FROM public.audio_file
             WHERE owner_auth_user_id = $1 AND sha256 = $2', [$owner, trim($track['content_sha256'])]);
        if ($file === false || ($row = pg_fetch_assoc($file)) === false
            || $row['mime_type'] !== $track['mime_type']
            || (int) $row['size_bytes'] !== (int) $track['size_bytes']
            || @pg_query($media, 'COMMIT') === false) {
            fwrite(STDERR, "Could not save legacy audio for track {$after}\n");
            exit(1);
        }
        $linked = @pg_query_params($musico,
            'UPDATE public.track SET media_audio_id = $1 WHERE id = $2 AND media_audio_id IS NULL',
            [$row['id'], $after]);
        if ($linked === false) {
            fwrite(STDERR, "Could not link legacy track {$after}\n");
            exit(1);
        }
        $copied++;
    }
}

$links = @pg_query($musico,
    'SELECT t.id, t.media_audio_id, u.auth_user_id
     FROM public.track t JOIN public."user" u ON u.id = t.user_id');
if ($links === false) exit(1);
while (($link = pg_fetch_assoc($links)) !== false) {
    if ($link['media_audio_id'] === null) {
        fwrite(STDERR, "Unlinked Musico track {$link['id']} remains\n");
        exit(1);
    }
    $file = @pg_query_params($media,
        'SELECT 1 FROM public.audio_file WHERE id = $1 AND owner_auth_user_id = $2',
        [$link['media_audio_id'], $link['auth_user_id']]);
    if ($file === false || pg_num_rows($file) !== 1) {
        fwrite(STDERR, "Media audio is missing for Musico track {$link['id']}\n");
        exit(1);
    }
}
echo "Linked {$copied} legacy Musico tracks to Media audio.\n";
