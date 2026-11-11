<?php
declare(strict_types=1);

return [
    'name' => 'Quiz', 'resource' => 'quizzes', 'read' => 'Read quizzes',
        'write' => 'Edit quizzes and attempts', 'database' => 'quiz',
        'resources_sql' => 'SELECT q.id, q.name FROM public.quiz q JOIN public."user" u ON u.id = q.user_id WHERE u.auth_user_id = $1 ORDER BY q.id DESC',
        'owner_sql' => 'SELECT u.auth_user_id FROM public.quiz q JOIN public."user" u ON u.id = q.user_id WHERE q.id = $1',
        'owner_image_upload' => false,
];
