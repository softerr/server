<?php

require_once('Api/Utils/Validator.php');
require_once('Api/Utils/Response.php');
require_once('Answer.php');

define('MULTIPLE_ANSWER', 1);
define('MULTIPLE_CHOICE', 2);
define('TRUE_FALSE', 3);
define('YES_NO', 4);
define('NUMBER', 5);
define('OPEN', 6);
define('SHORT', 7);
define('SHOW_ANSWER', 8);
define('NO_ANSWER', 9);

class Question
{
    public static function update(object $question, object &$dto)
    {
        $dto->id = $question->id;
        $dto->quiz_id = $question->quiz_id;

        if (isset($dto->type_id)) {
            $question->type_id = $dto->type_id;
        } else {
            $dto->type_id = $question->type_id;
        }

        if (isset($dto->question)) {
            $question->question = $dto->question;
        } else {
            $dto->question = $question->question;
        }
    }

    public static function validate_insert(&$dto)
    {
        Validator::object('Question', $dto);

        if (isset($dto->type_id)) {
            $dto->type_id = Validator::id('TypeId', $dto->type_id);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'TypeId is required');
        }

        if (isset($dto->question)) {
            $dto->question = Validator::string('Question', $dto->question);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Question is required');
        }

        if (isset($dto->answers)) {
            if (!is_array($dto->answers)) {
                throw new BadRequest(ERR_ARRAY, 'Answers is not an array');
            }
            foreach ($dto->answers as &$answer) {
                Answer::validate_insert($answer, $dto->type_id);
            }
        }
    }

    public static function validate_update(&$dto)
    {
        Validator::object('Question', $dto);

        if (isset($dto->type_id)) {
            $dto->type_id = Validator::id('TypeId', $dto->type_id);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'TypeId is required');
        }

        if (isset($dto->question)) {
            $dto->question = Validator::string('Question', $dto->question);
        }

        if (isset($dto->answers)) {
            if (!is_array($dto->answers)) {
                throw new BadRequest(ERR_ARRAY, 'Answers is not an array');
            }
            foreach ($dto->answers as &$answer) {
                Answer::validate_insert($answer, $dto->type_id);
            }
        }
    }
}
