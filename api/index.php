<?php
require_once('Api/Utils/Utils.php');
require_once('Api/Utils/Response.php');
require_once('Api/Utils/Router.php');
require_once('Api/User/Controller/UserController.php');
require_once('Api/Quiz/Controller/QuizController.php');

error_reporting(E_ALL);
ini_set('display_errors', 'On');

function api()
{
    Router::prefix(Utils::get_uri(), '/api', function ($uri) {
        UserController::route($uri);
        QuizController::route($uri);
    });
    throw new NotFound(ERR_NOT_FOUND);
}

try {
    api();
} catch (Response $r) {
    $r->show();
}
