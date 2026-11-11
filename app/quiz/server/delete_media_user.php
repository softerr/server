<?php
declare(strict_types=1);

return [
    'DELETE FROM public.quiz_import_recovery WHERE owner_auth_user_id = ANY($1::bigint[])',
];
