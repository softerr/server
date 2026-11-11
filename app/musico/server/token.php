<?php
declare(strict_types=1);

return [
    'name' => 'Musico', 'resource' => 'playlists', 'read' => 'Read Musico',
        'write' => 'Edit Musico', 'database' => 'musico',
        'resources_sql' => 'SELECT p.id, p.name FROM public.playlist p JOIN public."user" u ON u.id = p.user_id WHERE u.auth_user_id = $1 ORDER BY p.id DESC',
        'owner_sql' => 'SELECT u.auth_user_id FROM public.playlist p JOIN public."user" u ON u.id = p.user_id WHERE p.id = $1',
        'owner_image_upload' => true,
        'owner_image_reference_sql' => 'SELECT 1 FROM public.track t JOIN public."user" u ON u.id = t.user_id
             WHERE u.auth_user_id = $1 AND t.art_image_id = $2
               AND ($3::boolean OR EXISTS (SELECT 1 FROM public.playlist_track pt
                   WHERE pt.track_id = t.id AND pt.playlist_id = ANY($4::bigint[]))) LIMIT 1',
];
