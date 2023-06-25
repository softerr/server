<?php
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Controller/UserController.php');
require_once('Api/Quiz/Controller/PublicQuizController.php');
require_once('Api/Quiz/Controller/ModQuizController.php');
require_once('Api/Quiz/Controller/TypeController.php');
require_once('Api/Quiz/Controller/RoleController.php');

class QuizController
{
    public static function route(string $uri)
    {
        Router::prefix($uri, '/quiz', function ($uri) {
            UserController::route($uri);
            PublicQuizController::route($uri);
            ModQuizController::route($uri);
            TypeController::route($uri);
            RoleController::route($uri);
        });
    }
}
