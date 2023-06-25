<?php

require_once('Api/Utils/Validator.php');
require_once('Api/Utils/Response.php');

class UserRole
{
    public static function update(object $userRole, object &$dto)
    {
        $dto->id = $userRole->id;
        $dto->user_id = $userRole->user_id;

        if (isset($dto->role_id)) {
            $userRole->role_id = $dto->role_id;
        } else {
            $dto->role_id = $userRole->role_id;
        }
    }

    public static function validate_insert(&$dto)
    {
        Validator::object('UserRole', $dto);

        if (isset($dto->role_id)) {
            $dto->role_id = Validator::id('RoleId', $dto->role_id);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'RoleId is required');
        }
    }

    public static function validate_update(&$dto)
    {
        Validator::object('UserRole', $dto);

        if (isset($dto->role_id)) {
            $dto->role_id = Validator::id('RoleId', $dto->role_id);
        }
    }
}
