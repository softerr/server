<?php
declare(strict_types=1);

return [
    'DELETE FROM public.database_share WHERE auth_user_id = ANY($1::bigint[])',
];
