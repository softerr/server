<?php
require_once('Api/Utils/Router.php');
require_once('Api/Repo/RoleRepo.php');
require_once('Api/Utils/Auth.php');
require_once('Api/Utils/Response.php');

class RoleController
{
    public static function route(string $uri)
    {
        Router::prefix($uri, '/roles', function (string $uri) {
            Router::resolve($uri, '', RoleController::class, ['GET' => 'getAll']);
        });
    }

    public static function getAll($dto)
    {
        $user = Auth::authenticate();
        if (!in_array(ADMIN, $user->roles)) {
            throw new Forbidden(ERR_USR_FORBIDDEN);
        }

        $rolRepo = new RoleRepo(new Database());
        throw new Ok($rolRepo->get());
    }
}
