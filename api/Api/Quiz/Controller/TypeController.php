<?php
require_once('Api/Utils/Router.php');
require_once('Api/Quiz/Repo/TypeRepo.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Response.php');

class TypeController
{
    public static function route(string $uri)
    {
        Router::prefix($uri, '/types', function (string $uri) {
            Router::resolve($uri, '', TypeController::class, ['GET' => 'getAll']);
        });
    }

    public static function getAll($dto)
    {
        $user = Auth::authenticate();
        if (!in_array(USER, $user->roles) && !in_array(MOD, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $rolRepo = new TypeRepo(new Database());
        throw new Ok($rolRepo->get());
    }
}
