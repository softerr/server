<?php
require_once('Api/Utils/Router.php');
require_once('Api/Repo/GameQuizRepo.php');
require_once('Api/Repo/GameQuestionRepo.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Database.php');
require_once('Api/Manager/GameAnswerManager.php');
require_once('Api/Entity/GameAnswer.php');

class GameAnswerController
{
    public static function route(string $uri, int $quizId, int $gameQuizId, int $gameQuestionId)
    {
        Router::prefix($uri, '/answers', function (string $uri, int $quizId, int $gameQuizId, int $gameQuestionId) {
            Router::resolve($uri, '', GameAnswerController::class, ['PATCH' => 'updateAll'], $quizId, $gameQuizId, $gameQuestionId);
            Router::prefix($uri, '/(\d+)', function (string $uri, int $quizId, int $gameQuizId, int $gameQuestionId) {
            }, $quizId, $gameQuizId, $gameQuestionId);
        }, $quizId, $gameQuizId, $gameQuestionId);
    }

    public static function updateAll($dto, int $quizId, int $gameQuizId, int $gameQuestionId)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        if (!is_array($dto)) {
            throw new BadRequest(ERR_BAD_JSON_FORMAT);
        }

        foreach ($dto as &$answer) {
            GameAnswer::validate_update($answer);
        }
        $db = new Database();
        $gameQuizRepo = new GameQuizRepo($db);
        $gameQuiz = $gameQuizRepo->getNotEnded($gameQuizId, $user->id, $quizId);

        $gameQuestionRepo = new GameQuestionRepo($db);
        $gameQuestion = $gameQuestionRepo->getId($gameQuestionId, $gameQuiz->id);
        $questions = $gameQuestionRepo->getByGameQuizId($gameQuiz->id);
        if ($questions[$gameQuiz->current_question]['id'] != $gameQuestionId) {
            throw new BadRequest(ERR_NOT_CURRENT_QUESTION);
        }

        GameAnswerManager::updateAll($db, $gameQuestion->id, $dto, $gameQuestion->type_id);
        throw new Ok($dto);
    }
}
