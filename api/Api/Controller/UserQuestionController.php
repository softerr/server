<?php
require_once('Api/Utils/Router.php');
require_once('Api/Repo/QuizRepo.php');
require_once('Api/Repo/QuestionRepo.php');
require_once('Api/Repo/AnswerRepo.php');
require_once('Api/Entity/Question.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Utils.php');
require_once('Api/Utils/Database.php');
require_once('UserAnswerController.php');
require_once('Api/Manager/QuestionManager.php');

class UserQuestionController
{
    public static function route(string $uri, int $userId, int $quizId)
    {
        Router::prefix($uri, '/questions', function (string $uri, int $userId, int $quizId) {
            Router::resolve($uri, '', UserQuestionController::class, ['GET' => 'getAll', 'POST' => 'create'], $userId, $quizId);
            Router::prefix($uri, '/(\d+)', function (string $uri, int $userId, int $quizId, int $questionId) {
                Router::resolve($uri, '', UserQuestionController::class, ['PATCH' => 'update', 'PUT' => 'put', 'DELETE' => 'delete'], $userId, $quizId, $questionId);
                UserAnswerController::route($uri, $userId, $quizId, $questionId);
            }, $userId, $quizId);
        }, $userId, $quizId);
    }

    public static function getAll($dto, int $userId, int $quizId)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $db = new Database();
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getId($quizId, $userId);
        $questionRepo = new QuestionRepo($db);
        $questions = $questionRepo->getByQuizId($quiz->id);
        foreach ($questions as &$question) {
            $answerRepo = new AnswerRepo($db);
            $question['answers'] = $answerRepo->getByQuestionId($question['id']);
        }
        throw new Ok($questions);
    }

    public static function create($dto, int $userId, int $quizId)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        if (is_array($dto)) {
            foreach ($dto as &$question) {
                Question::validate_insert($question);
            }
        } else {
            Question::validate_insert($dto);
        }

        $db = new Database();
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getId($quizId, $userId);

        if (is_array($dto)) {
            foreach ($dto as &$question) {
                QuestionManager::insert($db, $quiz->id, $question);
            }
            throw new Created($dto);
        } else {
            QuestionManager::insert($db, $quiz->id, $dto);
            throw new Created($dto);
        }
    }

    public static function update($dto, int $userId, int $quizId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        Question::validate_update($dto);
        $db = new Database();
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getId($quizId, $userId);
        QuestionManager::update($db, $id, $quiz->id, $dto);
        throw new Ok($dto);
    }

    public static function delete($dto, int $userId, int $quizId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }
        $db = new Database();
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getId($quizId, $userId);
        QuestionManager::delete($db, $id, $quiz->id);
        throw new NoContent();
    }
}
