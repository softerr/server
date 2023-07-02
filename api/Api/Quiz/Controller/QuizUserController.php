<?php
require_once('Api/Utils/Router.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Database.php');
require_once('Api/Utils/Utils.php');
require_once('Api/User/Controller/UserController.php');
require_once('Api/User/Entity/User.php');
require_once('Api/Quiz/Controller/UserQuizController.php');
require_once('Api/Quiz/Controller/UserRoleController.php');
require_once('Api/Quiz/Repo/UserRoleRepo.php');

class QuizUserController
{
    public static function route(string $uri)
    {
        Router::prefix($uri, '/users', function (string $uri) {
            Router::resolve($uri, '/signin', QuizUserController::class, ['POST' => 'signin']);
            Router::prefix($uri, '/(\d+)', function (string $uri, int $id) {
                UserQuizController::route($uri, $id);
                UserRoleController::route($uri, $id);
            });
        });
    }

    public static function signin($dto)
    {
        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        $dto = User::validate_signin($dto);
        $userDb = new Database('user');
        $userRepo = new UserRepo($userDb);
        try {
            $user = $userRepo->getByEmail('quiz', $dto->email);
        } catch (NotFound $e) {
            throw new BadRequest(ERR_USR_LOGIN);
        }

        if (!$user || !password_verify($dto->password, $user->password)) {
            throw new BadRequest(ERR_USR_LOGIN);
        }

        $userRoleRepo = new UserRoleRepo(new Database('quiz'));
        $userRoleRepo->insertRoleIfNotExists($user->id, QUIZ_USER);

        $user = $userRepo->getByEmail('quiz', $dto->email);

        $loginTokenRepo = new LoginTokenRepo($userDb);
        UserController::setRefreshToken($loginTokenRepo->getTokenById($loginTokenRepo->insert($user->id)));
        throw new Ok((object)["token" => Auth::generateToken($user->id, $user->email, $user->username, array_map('intval', explode(',', $user->roles)))]);
    }
}
