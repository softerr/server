<?php
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Repo/UserRepo.php');
require_once('Api/Quiz/Repo/LoginTokenRepo.php');
require_once('Api/Quiz/Repo/ActivateTokenRepo.php');
require_once('Api/Quiz/Repo/PasswordTokenRepo.php');
require_once('Api/Quiz/Entity/User.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Database.php');
require_once('Api/Utils/Utils.php');
require_once('UserQuizController.php');
require_once('UserRoleController.php');

class UserController
{
    public static function route(string $uri)
    {
        Router::prefix($uri, '/users', function (string $uri) {
            Router::resolve($uri, '', UserController::class, ['GET' => 'getAll']);
            Router::prefix($uri, '/(\d+)', function (string $uri, int $id) {
                Router::resolve($uri, '', UserController::class, ['PATCH' => 'update', 'DELETE' => 'delete'], $id);
                UserQuizController::route($uri, $id);
                UserRoleController::route($uri, $id);
            });
        });
        Router::resolve($uri, '/signin', UserController::class, ['POST' => 'signin']);
        Router::resolve($uri, '/signup', UserController::class, ['POST' => 'signup']);
        Router::resolve($uri, '/refresh/signout', UserController::class, ['POST' => 'signout']);
        Router::resolve($uri, '/whoami', UserController::class, ['POST' => 'whoami']);
        Router::resolve($uri, '/refresh', UserController::class, ['POST' => 'refresh']);
        Router::resolve($uri, '/forgot_password', UserController::class, ['POST' => 'forgotPassword']);
        Router::resolve($uri, '/activate/(\w+)', UserController::class, ['POST' => 'activate']);
        Router::resolve($uri, '/begin_reset_password/(\w+)', UserController::class, ['POST' => 'beginResetPassword']);
        Router::resolve($uri, '/reset_password/(\w+)', UserController::class, ['POST' => 'resetPassword']);
    }

    public static function getAll($dto)
    {
        $user = Auth::authenticate();
        if (!in_array(ADMIN, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $db = new Database();
        $userRepo = new UserRepo($db);
        throw new Ok($userRepo->get());
    }

    public static function update($dto, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(ADMIN, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        User::validate_update($dto);
        $userRepo = new UserRepo(new Database());
        $userRepo->update($id, $dto);
        throw new Ok($dto);
    }

    public static function delete($dto, int $id)
    {
        $user = Auth::authenticate();
        if (!in_array(ADMIN, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }
        $db = new Database();
        $userRepo = new UserRepo($db);
        $user = $userRepo->delete($id);
        throw new NoContent();
    }

    public static function signin($dto)
    {
        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        $dto = User::validate_signin($dto);
        $db = new Database();
        $userRepo = new UserRepo($db);
        try {
            $user = $userRepo->getByEmail($dto->email);
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

    public static function signup($dto)
    {
        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        $dto = User::validate_signup($dto);
        $roles = [1];
        $db = new Database();
        $userRepo = new UserRepo($db);
        if ($userRepo->getCountByEmail($dto->email) != 0) {
            throw new BadRequest(ERR_USR_EMAIL_EXISTS);
        }
        if (isset($dto->username)) {
            if ($userRepo->getCountByUsername($dto->username) != 0) {
                throw new BadRequest(ERR_USR_USERNAME_EXISTS);
            }
        }

        $user = $userRepo->insert($roles, $dto);
        $activateTokenRepo = new ActivateTokenRepo($db);
        $activateToken = $activateTokenRepo->getTokenById($activateTokenRepo->insert($user->id));
        $url = "http://localhost:3000/activate/$activateToken";

        $headers = "MIME-Version: 1.0" . "\r\n";
        $headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
        $headers .= 'From: QuizzMaker<info@quizzmaker.com>' . "\r\n";
        if (mail($dto->email, 'Account Activation', "<p>To activate your account please follow this link: <a target=\"_\" href=\"$url\">Activate Link</a></p>", $headers)) {
            throw new Created($user);
        } else {
            throw new InternalServerError(ERR_SEND_EMAIL);
        }
    }

    public static function signout()
    {
        if (!array_key_exists('token', $_COOKIE)) {
            throw new Unauthorized(ERR_AUTH_NO_REFRESH_TOKEN);
        }
        $db = new Database();
        $loginTokenRepo = new LoginTokenRepo($db);
        $loginTokenRepo->setExpiredByToken($_COOKIE['token']);
        setcookie('token', NULL, 1);
        throw new NoContent();
    }

    public static function whoami()
    {
        throw new Ok(Auth::authenticate());
    }

    public static function refresh()
    {
        if (!array_key_exists('token', $_COOKIE)) {
            throw new Unauthorized(ERR_AUTH_NO_REFRESH_TOKEN);
        }
        $db = new Database();
        $loginTokenRepo = new LoginTokenRepo($db);
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

    private static function setRefreshToken(string $token)
    {
        setcookie('token', $token, time() + 14400, '/quiz/api/refresh', 'localhost', false, true);
    }

    public static function activate($dto, string $token)
    {
        $db = new Database();
        $activateTokenRepo = new ActivateTokenRepo($db);
        try {
            $user = $activateTokenRepo->getUserByToken($token);
        } catch (NotFound $e) {
            throw new BadRequest(ERR_EXPIRED_TOKEN);
        }

        $activateTokenRepo->setExpired($user->token_id);
        $userRepo = new UserRepo($db);
        $userRepo->activate($user->id);
        throw new NoContent();
    }

    public static function forgotPassword($dto)
    {
        if (!isset($dto)) {
            throw new BadRequest(ERR_NO_DATA);
        }

        if (isset($dto->email)) {
            $dto->email = Validator::email('Email', $dto->email);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Email is required');
        }

        $db = new Database();
        $userRepo = new UserRepo($db);
        $user = $userRepo->getByEmail($dto->email);
        $passwordTokenRepo = new PasswordTokenRepo($db);
        $passwordToken = $passwordTokenRepo->getTokenById($passwordTokenRepo->insert($user->id));
        $url = "http://localhost:3000/reset_password/$passwordToken";

        $headers = "MIME-Version: 1.0" . "\r\n";
        $headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
        $headers .= 'From: QuizzMaker<info@quizzmaker.com>' . "\r\n";
        if (mail($dto->email, 'Reset Password', "<p>To reset your password please follow this link: <a target=\"_\" href=\"$url\">Reset Password Link</a></p>", $headers)) {
            throw new NoContent();
        } else {
            throw new InternalServerError(ERR_SEND_EMAIL);
        }
    }

    public static function beginResetPassword($dto, string $token)
    {
        $db = new Database();
        $passwordTokenRepo = new PasswordTokenRepo($db);
        try {
            $user = $passwordTokenRepo->getUserByToken($token);
        } catch (NotFound $e) {
            throw new BadRequest(ERR_EXPIRED_TOKEN);
        }

        $passwordTokenRepo->setUsed($user->token_id);
        throw new Ok((object)["token" => $token]);
    }

    public static function resetPassword($dto, string $token)
    {
        if (isset($dto->password)) {
            $dto->password = Validator::password('Password', $dto->password);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Password is required');
        }

        $db = new Database();
        $passwordTokenRepo = new PasswordTokenRepo($db);
        try {
            $user = $passwordTokenRepo->getUserByToken($token);
        } catch (NotFound $e) {
            throw new BadRequest(ERR_EXPIRED_TOKEN);
        }

        $userRepo = new UserRepo($db);
        $userRepo->updatePassword($user->id, $dto);

        $passwordTokenRepo->setExpired($user->token_id);
        throw new NoContent();
    }
}
