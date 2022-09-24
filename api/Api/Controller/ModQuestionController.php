<?php
require_once('Api/Utils/Router.php');
require_once('Api/Repo/QuizRepo.php');
require_once('Api/Repo/QuestionRepo.php');
require_once('Api/Repo/AnswerRepo.php');
require_once('Api/Entity/Question.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Utils.php');
require_once('Api/Utils/Database.php');
require_once('Api/Manager/QuestionManager.php');

class ModQuestionController
{
    public static function route(string $uri, int $quizId)
    {
        Router::prefix($uri, '/questions', function (string $uri, int $quizId) {
            Router::resolve($uri, '', ModQuestionController::class, ['GET' => 'getAll'], $quizId);
        }, $quizId);
    }

    public static function getAll($dto, int $quizId)
    {
        $user = Auth::authenticate();
        if (!in_array(MOD, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $db = new Database();
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getPublicId($quizId);
        $questionRepo = new QuestionRepo($db);
        $questions = $questionRepo->getByQuizId($quiz->id);
        foreach ($questions as &$question) {
            $answerRepo = new AnswerRepo($db);
            $question['answers'] = $answerRepo->getByQuestionId($question['id']);
        }
        throw new Ok($questions);
    }
}
