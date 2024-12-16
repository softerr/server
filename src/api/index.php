<?php
require_once('Utils/Utils.php');
require_once('Utils/Response.php');
require_once('Utils/Router.php');
require_once('User/Controller/UserController.php');

error_reporting(E_ALL);
ini_set('display_errors', 'On');

function api()
{
    Router::prefix(Utils::get_uri(), '/api', function ($uri) {
        UserController::route($uri);
    });
    throw new NotFound(ERR_NOT_FOUND);
}

try {
    api();
} catch (Response $r) {
    $r->show();
}
