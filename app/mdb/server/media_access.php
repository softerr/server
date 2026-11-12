<?php
declare(strict_types=1);

return static function (array $imageIds, array $user): array {
    if (($user['account_kind'] ?? 'human') !== 'human' || $imageIds === []) return [];
    $result = @pg_query_params(connectAppDb('mdb'),
        'SELECT DISTINCT selected.id AS image_id
         FROM unnest($1::bigint[]) AS selected(id)
         JOIN public.database_cell v ON v.value = selected.id::text
         JOIN public.database_column c ON c.database_id = v.database_id AND c.id = v.column_id
         JOIN public.user_database d ON d.id = v.database_id
         JOIN public."user" u ON u.id = d.user_id
         WHERE c.type = \'image\'
           AND (u.auth_user_id = $2 OR EXISTS (
               SELECT 1 FROM public.database_share s
               WHERE s.database_id = d.id AND s.auth_user_id = $2))',
        ['{' . implode(',', $imageIds) . '}', $user['id']]);
    if ($result === false) respond(500, ['error' => 'Failed to check shared database images']);
    $visible = [];
    while (($row = pg_fetch_assoc($result)) !== false) $visible[] = (int) $row['image_id'];
    return $visible;
};
