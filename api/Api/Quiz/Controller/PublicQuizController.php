<?php
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Repo/QuizRepo.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Response.php');
require_once('GameQuizController.php');
require_once('Api/Quiz/Entity/Quiz.php');

class PublicQuizController
{
    public static function route(string $uri)
    {
        Router::prefix($uri, '/quizzes', function (string $uri) {
            Router::resolve($uri, '', PublicQuizController::class, ['GET' => 'getAll']);
            Router::prefix($uri, '/(\d+)', function (string $uri, int $quizId) {
                GameQuizController::route($uri, $quizId);
            });
        });
    }

    public static function getAll($dto)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $quizRepo = new QuizRepo(new Database());
        throw new Ok($quizRepo->getPublicQuizzes());
    }
}
