<?php
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Repo/QuizRepo.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Manager/GameQuizManager.php');
require_once('Api/Quiz/Entity/GameQuiz.php');
require_once('GameQuestionController.php');

class GameQuizController
{
    public static function route(string $uri, int $quizId)
    {
        Router::prefix($uri, '/games', function (string $uri, int $quizId) {
            Router::resolve($uri, '', GameQuizController::class, ['POST' => 'create'], $quizId);
            Router::prefix($uri, '/(\d+)', function (string $uri, int $quizId, int $gameQuizId) {
                Router::resolve($uri, '', GameQuizController::class, ['PATCH' => 'update'], $quizId, $gameQuizId);
                GameQuestionController::route($uri, $quizId, $gameQuizId);
            }, $quizId);
        }, $quizId);
    }

    public static function create($dto, int $quizId)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $db = new Database();
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getPublicId($quizId);

        GameQuizManager::insert($db, $user->id, $quiz->id, $dto);
        throw new Created($dto);
    }

    public static function update($dto, int $quizId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        GameQuiz::validate_update($dto);
        $db = new Database();
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getPublicId($quizId);
        GameQuizManager::update($db, $id, $user->id, $quiz->id, $dto);
        throw new Ok($dto);
    }
}
