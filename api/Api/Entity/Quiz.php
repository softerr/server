<?php

require_once('Api/Utils/Validator.php');
require_once('Api/Utils/Response.php');

class Quiz
{
    public static function update(object $quiz, object &$dto)
    {
        $dto->id = $quiz->id;
        $dto->user_id = $quiz->user_id;
        $dto->status = $quiz->status;

        if (isset($dto->name)) {
            $quiz->name = $dto->name;
        } else {
            $dto->name = $quiz->name;
        }

        if (isset($dto->description)) {
            $quiz->description = $dto->description;
        } else {
            $dto->description = $quiz->description;
        }

        if (isset($dto->public)) {
            $quiz->public = $dto->public;
        } else {
            $dto->public = $quiz->public;
        }
    }

    public static function update_public(object $quiz, object &$dto)
    {
        $dto->id = $quiz->id;
        $dto->user_id = $quiz->user_id;
        $dto->name = $quiz->name;
        $dto->description = $quiz->description;
        $dto->public = $quiz->public;

        if (isset($dto->status)) {
            $quiz->status = $dto->status;
        } else {
            $dto->status = $quiz->status;
        }
    }

    public static function validate_insert(&$dto)
    {
        Validator::object('Quiz', $dto);

        if (isset($dto->name)) {
            $dto->name = Validator::string('Name', $dto->name);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Name is required');
        }

        if (isset($dto->description)) {
            $dto->description = Validator::string('Description', $dto->description, true);
        } else {
            $dto->description = null;
        }


        if (isset($dto->public)) {
            $dto->public = Validator::bool('Public', $dto->public);
        } else {
            $dto->public = 0;
        }
    }

    public static function validate_update(&$dto)
    {
        Validator::object('Quiz', $dto);

        if (isset($dto->name)) {
            $dto->name = Validator::string('Name', $dto->name);
        }

        if (isset($dto->description)) {
            $dto->description = Validator::string('Description', $dto->description, true);
        }

        if (isset($dto->public)) {
            $dto->public = Validator::bool('Public', $dto->public);
        }
    }

    public static function validate_update_public(&$dto)
    {
        Validator::object('Quiz', $dto);

        if (isset($dto->status)) {
            $dto->status = Validator::int('Status', $dto->status);
        }
    }
}
