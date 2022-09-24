<?php
require_once('Api/Utils/Router.php');
require_once('Api/Repo/QuizRepo.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Response.php');
require_once('GameQuizController.php');
require_once('ModQuestionController.php');
require_once('Api/Entity/Quiz.php');

class ModQuizController
{
    public static function route(string $uri)
    {
        Router::prefix($uri, '/modquizzes', function (string $uri) {
            Router::resolve($uri, '', ModQuizController::class, ['GET' => 'getAll']);
            Router::prefix($uri, '/(\d+)', function (string $uri, int $quizId) {
                Router::resolve($uri, '', ModQuizController::class, ['PATCH' => 'update'], $quizId);
                ModQuestionController::route($uri, $quizId);
            });
        });
    }

    public static function getAll($dto)
    {
        $user = Auth::authenticate();
        if (!in_array(MOD, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $quizRepo = new QuizRepo(new Database());
        throw new Ok($quizRepo->getModQuizzes());
    }

    public static function update($dto, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(MOD, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        Quiz::validate_update_public($dto);
        $quizRepo = new QuizRepo(new Database());
        $quizRepo->updatePublic($id, $dto);
        throw new Ok($dto);
    }
}
