<?php

require_once('Api/Utils/Validator.php');

define('USER', 1);
define('MOD', 2);
define('ADMIN', 3);

class User
{
    public int $id;
    public string $email;
    public $username;
    public array $roles;

    public function __construct(object $dto)
    {
        $this->email = $dto->email;
        $this->username = $dto->username;
    }

    public static function validate_signup(object $dto)
    {
        if (isset($dto->email)) {
            $dto->email = Validator::email('Email', $dto->email);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Email is required');
        }

        if (isset($dto->username)) {
            $dto->username = Validator::string('Username', $dto->username);
        } else {
            $dto->username = null;
        }

        if (isset($dto->password)) {
            $dto->password = Validator::password('Password', $dto->password);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Password is required');
        }

        return $dto;
    }

    public static function validate_signin(object $dto)
    {
        if (isset($dto->email)) {
            $dto->email = Validator::email('Email', $dto->email);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Email is required');
        }

        if (isset($dto->password)) {
            $dto->password = Validator::password('Password', $dto->password);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Password is required');
        }

        return $dto;
    }

    public static function validate_update(&$dto)
    {
        Validator::object('User', $dto);

        if (isset($dto->email)) {
            $dto->email = Validator::email('Email', $dto->email);
        }

        if (isset($dto->username)) {
            $dto->username = Validator::string('Username', $dto->username);
        }
    }

    public static function update(object $user, object &$dto)
    {
        $dto->id = $user->id;
        $dto->roles = $user->roles;

        if (isset($dto->email)) {
            $user->email = $dto->nemailame;
        } else {
            $dto->email = $user->email;
        }

        if (isset($dto->username)) {
            $user->username = $dto->username;
        } else {
            $dto->username = $user->username;
        }
    }
}
