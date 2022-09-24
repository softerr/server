<?php
require_once('Api/Utils/Utils.php');
require_once('Api/Utils/Response.php');
require_once('Api/Utils/Router.php');
require_once('Api/Controller/UserController.php');
require_once('Api/Controller/PublicQuizController.php');
require_once('Api/Controller/ModQuizController.php');
require_once('Api/Controller/TypeController.php');
require_once('Api/Controller/RoleController.php');

function api()
{
    Router::prefix(Utils::get_uri(), '/api/quiz', function ($uri) {
        UserController::route($uri);
        PublicQuizController::route($uri);
        ModQuizController::route($uri);
        TypeController::route($uri);
        RoleController::route($uri);
    });
    throw new NotFound(ERR_NOT_FOUND);
}

try {
    api();
} catch (Response $r) {
    $r->show();
}
