<?php
declare(strict_types=1);

return [
    'name' => 'MDB', 'resource' => 'databases', 'read' => 'Read MDB',
        'write' => 'Edit MDB', 'database' => 'mdb',
        'resources_sql' => 'SELECT d.id, d.name FROM public.user_database d JOIN public."user" u ON u.id = d.user_id WHERE u.auth_user_id = $1 ORDER BY d.id DESC',
        'owner_sql' => 'SELECT u.auth_user_id FROM public.user_database d JOIN public."user" u ON u.id = d.user_id WHERE d.id = $1',
        'owner_image_upload' => true,
        'owner_image_reference_sql' => 'SELECT 1 FROM public.database_cell v
             JOIN public.database_column c ON c.id = v.column_id AND c.database_id = v.database_id
             JOIN public.user_database d ON d.id = v.database_id
             JOIN public."user" u ON u.id = d.user_id
             WHERE u.auth_user_id = $1 AND c.type = \'image\' AND v.value = $2::text
               AND ($3::boolean OR d.id = ANY($4::bigint[])) LIMIT 1',
];
