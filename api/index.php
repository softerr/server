<?php
require_once('Api/Utils/Utils.php');
require_once('Api/Utils/Response.php');
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Controller/QuizController.php');

function api()
{
    Router::prefix(Utils::get_uri(), '/api', function ($uri) {
        QuizController::route($uri);
    });
    throw new NotFound(ERR_NOT_FOUND);
}

try {
    api();
} catch (Response $r) {
    $r->show();
}
