<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit(1);
require_once __DIR__ . '/artwork_names.php';

$mediaDb = @pg_connect('host=/var/run/postgresql dbname=media user=postgres');
$musicoDb = @pg_connect('host=/var/run/postgresql dbname=musico user=postgres');
if ($mediaDb === false || $musicoDb === false) {
    fwrite(STDERR, "Could not connect to artwork databases\n");
    exit(1);
}
$generic = @pg_query($mediaDb,
    "SELECT id, owner_auth_user_id FROM public.image
     WHERE owner_auth_user_id IS NOT NULL AND shared = FALSE
       AND lower(original_name) IN ('album-art.png', 'album-art.jpg', 'album-art.jpeg', 'album-art.webp')");
if ($generic === false) {
    fwrite(STDERR, "Could not list generic artwork names\n");
    exit(1);
}
$owners = [];
while ($row = pg_fetch_assoc($generic)) $owners[(int) $row['id']] = (int) $row['owner_auth_user_id'];
if ($owners === []) {
    echo "No generic artwork names to update.\n";
    exit(0);
}
$ids = '{' . implode(',', array_keys($owners)) . '}';
$tracks = @pg_query_params($musicoDb,
    'SELECT DISTINCT ON (t.art_image_id) t.art_image_id, u.auth_user_id,
            t.artist, t.album, t.title
     FROM public.track t JOIN public."user" u ON u.id = t.user_id
     WHERE t.art_image_id = ANY($1::bigint[])
     ORDER BY t.art_image_id, (t.album = \'\') ASC, t.id', [$ids]);
if ($tracks === false) {
    fwrite(STDERR, "Could not list artwork tracks\n");
    exit(1);
}
$renamed = 0;
while ($track = pg_fetch_assoc($tracks)) {
    $id = (int) $track['art_image_id'];
    $owner = (int) $track['auth_user_id'];
    if (($owners[$id] ?? null) !== $owner) continue;
    try {
        if (renameGenericMusicoArtwork($mediaDb, $id, $owner,
            $track['artist'], $track['album'], $track['title'])) $renamed++;
    } catch (RuntimeException $error) {
        fwrite(STDERR, $error->getMessage() . "\n");
        exit(1);
    }
}
echo "Renamed {$renamed} existing album artwork images.\n";
