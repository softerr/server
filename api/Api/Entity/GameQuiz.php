<?php

require_once('Api/Utils/Validator.php');
require_once('Api/Utils/Response.php');
require_once('GameAnswer.php');

class GameQuiz
{
    public static function update(object $gameQuiz, object &$dto)
    {
        $dto->id = $gameQuiz->id;
        $dto->user_id = $gameQuiz->user_id;
        $dto->quiz_id = $gameQuiz->quiz_id;
        $dto->start = $gameQuiz->start;

        if (isset($dto->end)) {
            $gameQuiz->end = $dto->end;
        } else {
            $dto->end = $gameQuiz->end;
        }

        if (isset($dto->current_question) && (!isset($gameQuiz->end) || !$gameQuiz->end)) {
            $gameQuiz->current_question = $dto->current_question;
        } else {
            $dto->current_question = $gameQuiz->current_question;
        }
    }

    public static function validate_update(&$dto)
    {
        if (isset($dto->current_question)) {
            $dto->current_question = Validator::int('Current question', $dto->current_question);
        }

        if (isset($dto->end)) {
            $dto->end = Validator::bool('End', $dto->end);
        }

        if (isset($dto->answers)) {
            if (!is_array($dto->answers)) {
                throw new BadRequest(ERR_ARRAY, 'Answers is not an array');
            }
            foreach ($dto->answers as &$answer) {
                GameAnswer::validate_update($answer);
            }
        }
    }
}
