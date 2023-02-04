<?php

require_once('Api/Utils/Validator.php');
require_once('Api/Utils/Response.php');
require_once('Question.php');

class Answer
{
    public static function update(object $answer, object &$dto)
    {
        $dto->id = $answer->id;
        $dto->question_id = $answer->question_id;
        if (isset($dto->answer)) {
            $answer->answer = $dto->answer;
        } else {
            $dto->answer = $answer->answer;
        }

        if (isset($dto->correct)) {
            $answer->correct = $dto->correct;
        } else {
            $dto->correct = $answer->correct;
        }
    }

    public static function validate_insert(&$dto, int $type)
    {
        Validator::object('Answer', $dto);

        if ($type == TRUE_FALSE || $type == YES_NO || $type == OPEN || $type == NO_ANSWER) {
            $dto->answer = null;
        } else {
            if (isset($dto->answer)) {
                $dto->answer = Validator::string('Answer', $dto->answer);
            } else {
                throw new BadRequest(ERR_REQUIRED, 'Answer is required');
            }
        }

        if ($type == MULTIPLE_ANSWER || $type == MULTIPLE_CHOICE || $type == TRUE_FALSE || $type == YES_NO) {
            if (isset($dto->correct)) {
                $dto->correct = Validator::bool('Correct', $dto->correct);
            } else {
                throw new BadRequest(ERR_REQUIRED, 'Correct is required');
            }
        } else {
            $dto->correct = null;
        }
    }

    public static function validate_update(&$dto)
    {
        Validator::object('Answer', $dto);

        if (isset($dto->answer)) {
            $dto->answer = Validator::string('Answer', $dto->answer);
        }

        if (isset($dto->correct)) {
            $dto->correct = Validator::bool('Correct', $dto->correct);
        }
    }
}
