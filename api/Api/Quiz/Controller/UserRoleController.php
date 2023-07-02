<?php
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Repo/UserRoleRepo.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Response.php');
require_once('Api/Quiz/Entity/QuizUserRole.php');

class UserRoleController
{
    public static function route(string $uri, $userId)
    {
        Router::prefix($uri, '/roles', function (string $uri, int $userId) {
            Router::resolve($uri, '', UserRoleController::class, ['GET' => 'getAll', 'POST' => 'create'], $userId);
            Router::resolve($uri, '/(\d+)', UserRoleController::class, ['PATCH' => 'update', 'DELETE' => 'delete'], $userId);
        }, $userId);
    }

    public static function getAll($dto, int $userId)
    {
        $user = Auth::authenticate();
        if (!in_array(QUIZ_ADMIN, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $userRoleRepo = new UserRoleRepo(new Database('quiz'));
        throw new Ok($userRoleRepo->getByUserId($userId));
    }


    public static function create($dto, int $userId)
    {
        $user = Auth::authenticate();
        if (!in_array(QUIZ_ADMIN, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        QuizUserRole::validate_insert($dto);
        $userRepo = new UserRepo(new Database('user'));
        $user = $userRepo->getId($userId);
        $userRoleRepo = new UserRoleRepo(new Database('quiz'));
        $userRoleRepo->insert($user->id, $dto);
        throw new Created($dto);
    }

    public static function update($dto, int $userId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(QUIZ_ADMIN, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        QuizUserRole::validate_update($dto);
        $userRepo = new UserRepo(new Database('user'));
        $user = $userRepo->getId($userId);
        $userRoleRepo = new UserRoleRepo(new Database('quiz'));
        $userRoleRepo->update($id, $user->id, $dto);
        throw new Ok($dto);
    }

    public static function delete($dto, int $userId, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(QUIZ_ADMIN, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }
        $userRepo = new UserRepo(new Database('user'));
        $user = $userRepo->getId($userId);
        $userRoleRepo = new UserRoleRepo(new Database('quiz'));
        $userRoleRepo->delete($id, $user->id);
        throw new NoContent();
    }
}
