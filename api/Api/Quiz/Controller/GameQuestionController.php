<?php
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Repo/QuizRepo.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Manager/GameQuizManager.php');
require_once('Api/Quiz/Entity/GameQuiz.php');
require_once('GameAnswerController.php');

class GameQuestionController
{
    public static function route(string $uri, int $quizId, int $gameQuizId)
    {
        Router::prefix($uri, '/questions', function (string $uri, int $quizId, int $gameQuizId) {
            Router::prefix($uri, '/(\d+)', function (string $uri, int $quizId, int $gameQuizId, int $gameQuestionId) {
                GameAnswerController::route($uri, $quizId, $gameQuizId, $gameQuestionId);
            }, $quizId, $gameQuizId);
        }, $quizId, $gameQuizId);
    }
}
