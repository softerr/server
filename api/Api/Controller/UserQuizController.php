<?php
require_once('Api/Utils/Router.php');
require_once('Api/Repo/QuizRepo.php');
require_once('Api/Entity/Quiz.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Response.php');
require_once('Api/Utils/Database.php');
require_once('UserQuestionController.php');

class UserQuizController
{
    public static function route(string $uri, int $userId)
    {
        Router::prefix($uri, '/quizzes', function (string $uri, int $userId) {
            Router::resolve($uri, '', UserQuizController::class, ['GET' => 'getAll', 'POST' => 'create'], $userId);
            Router::prefix($uri, '/(\d+)', function (string $uri, int $userId, int $quizId) {
                Router::resolve($uri, '', UserQuizController::class, ['PATCH' => 'update', 'DELETE' => 'delete'], $userId, $quizId);
                UserQuestionController::route($uri, $userId, $quizId);
            }, $userId);
        }, $userId);
    }

    public static function getAll($dto, int $userId)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $db = new Database();
        $userRepo = new UserRepo($db);
        $user = $userRepo->getId($userId);
        $quizRepo = new QuizRepo($db);
        throw new Ok($quizRepo->getByUserId($user->id));
    }

    public static function create($dto, int $userId)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        Quiz::validate_insert($dto);
        $db = new Database();
        $userRepo = new UserRepo($db);
        $user = $userRepo->getId($userId);
        $quizRepo = new QuizRepo($db);
        $quizRepo->insert($user->id, $dto);
        throw new Created($dto);
    }

    public static function update($dto, int $userId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        Quiz::validate_update($dto);
        $db = new Database();
        $userRepo = new UserRepo($db);
        $user = $userRepo->getId($userId);
        $quizRepo = new QuizRepo($db);
        $quizRepo->update($id, $user->id, $dto);
        throw new Ok($dto);
    }

    public static function delete($dto, int $userId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) || $user->id != $userId) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }
        $db = new Database();
        $userRepo = new UserRepo($db);
        $user = $userRepo->getId($userId);
        $quizRepo = new QuizRepo($db);
        $quizRepo->delete($id, $user->id);
        throw new NoContent();
    }
}