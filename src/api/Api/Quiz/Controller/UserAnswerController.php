<?php
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Repo/QuizRepo.php');
require_once('Api/Quiz/Repo/QuestionRepo.php');
require_once('Api/Quiz/Repo/AnswerRepo.php');
require_once('Api/Quiz/Entity/Answer.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Utils.php');
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Manager/AnswerManager.php');

class UserAnswerController
{
    public static function route(string $uri, int $userId, int $quizId, int $questionId)
    {
        Router::prefix($uri, '/answers', function (string $uri, int $userId, int $quizId, int $questionId) {
            Router::resolve($uri, '', UserAnswerController::class, ['GET' => 'getAll', 'POST' => 'create'], $userId, $quizId, $questionId);
            Router::resolve($uri, '/(\d+)', UserAnswerController::class, ['PATCH' => 'update', 'DELETE' => 'delete'], $userId, $quizId, $questionId);
        }, $userId, $quizId, $questionId);
    }

    public static function getAll($dto, int $userId, int $quizId, int $questionId)
    {
        $user = Auth::authenticate();
        if (!in_array(QUIZ_USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $db = new Database('quiz');
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getId($quizId, $userId);
        $questionRepo = new QuestionRepo($db);
        $question = $questionRepo->getId($questionId, $quiz->id);
        $answerRepo = new AnswerRepo($db);
        throw new Ok($answerRepo->getByQuestionId($question->id));
    }

    public static function create($dto, int $userId, int $quizId, int $questionId)
    {
        $user = Auth::authenticate();
        if (!in_array(QUIZ_USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        $db = new Database('quiz');
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getId($quizId, $userId);
        $questionRepo = new QuestionRepo($db);
        $question = $questionRepo->getId($questionId, $quiz->id);

        if (is_array($dto)) {
            foreach ($dto as &$answer) {
                Answer::validate_insert($answer, $question->type_id);
            }
        } else {
            Answer::validate_insert($dto, $question->type_id);
        }

        if (is_array($dto)) {
            foreach ($dto as &$answer) {
                AnswerManager::insert($db, $question->id, $answer);
            }
            throw new Created($dto);
        } else {
            AnswerManager::insert($db, $question->id, $dto);
            throw new Created($dto);
        }
    }

    public static function update($dto, int $userId, int $quizId, int $questionId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(QUIZ_USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        Answer::validate_update($dto);
        $db = new Database('quiz');
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getId($quizId, $userId);
        $questionRepo = new QuestionRepo($db);
        $question = $questionRepo->getId($questionId, $quiz->id);
        AnswerManager::update($db, $id, $question->id, $dto, $question->type_id);
        throw new Ok($dto);
    }

    public static function delete($dto, int $userId, int $quizId, int $questionId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(QUIZ_USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }
        $db = new Database('quiz');
        $quizRepo = new QuizRepo($db);
        $quiz = $quizRepo->getId($quizId, $userId);
        $questionRepo = new QuestionRepo($db);
        $question = $questionRepo->getId($questionId, $quiz->id);
        AnswerManager::delete($db, $id, $question->id);
        throw new NoContent();
    }
}
