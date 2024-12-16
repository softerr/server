<?php
require_once('User/Repo/UserRepo.php');
require_once('User/Repo/LoginTokenRepo.php');
require_once('User/Entity/User.php');
require_once('Utils/Auth.php');
require_once('Utils/Database.php');
require_once('Utils/Router.php');
require_once('Utils/Utils.php');

class UserController
{
    public static function route(string $uri)
    {
        Router::prefix($uri, '/users', function (string $uri) {
            Router::resolve($uri, '/signin', UserController::class, ['POST' => 'signin']);
            Router::resolve($uri, '/refresh/signout', UserController::class, ['POST' => 'signout']);
            Router::resolve($uri, '/refresh', UserController::class, ['POST' => 'refresh']);
        });
    }

    public static function signin($dto)
    {
        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        $dto = User::validate_signin($dto);
        $db = new Database('user');
        $userRepo = new UserRepo($db);
        try {
            $user = $userRepo->getByEmail('user', $dto->email);
        } catch (NotFound $e) {
            throw new BadRequest(ERR_USR_LOGIN);
        }

        if (!$user || !password_verify($dto->password, $user->password)) {
            throw new BadRequest(ERR_USR_LOGIN);
        }
        $loginTokenRepo = new LoginTokenRepo($db);
        self::setRefreshToken($loginTokenRepo->getTokenById($loginTokenRepo->insert($user->id)));
        throw new Ok((object)["token" => Auth::generateToken($user->id, $user->email, $user->username, array_map('intval', explode(',', $user->roles)))]);
    }

    public static function signout()
    {
        var_dump($_COOKIE);
        if (!array_key_exists('token', $_COOKIE)) {
            throw new Unauthorized(ERR_AUTH_NO_REFRESH_TOKEN);
        }
        $loginTokenRepo = new LoginTokenRepo(new Database('user'));
        $loginTokenRepo->setExpiredByToken($_COOKIE['token']);
        setcookie('token', NULL, 1);
        throw new NoContent();
    }

    public static function refresh()
    {
        if (!array_key_exists('token', $_COOKIE)) {
            throw new Unauthorized(ERR_AUTH_NO_REFRESH_TOKEN);
        }
        $loginTokenRepo = new LoginTokenRepo(new Database('user'));
        try {
            $user = $loginTokenRepo->getUserByToken($_COOKIE['token']);
        } catch (NotFound $e) {
            setcookie('token', NULL, 1);
            throw new Unauthorized(ERR_AUTH_EXPIRED_REFRESH_TOKEN);
        }
        $loginTokenRepo->setExpiredById($user->token_id);
        self::setRefreshToken($loginTokenRepo->getTokenById($loginTokenRepo->insert($user->id)));
        throw new Ok(['token' => Auth::generateToken($user->id, $user->email, $user->username, array_map('intval', explode(',', $user->roles)))]);
    }

    public static function setRefreshToken(string $token)
    {
        setcookie('token', $token, time() + 14400, '/api/users/refresh', 'localhost', false, true);
    }
}
