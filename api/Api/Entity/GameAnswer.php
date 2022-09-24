<?php

require_once('Api/Utils/Validator.php');
require_once('Api/Utils/Response.php');

class GameAnswer
{
    public int $id;
    public int $game_question_id;
    public string $answer;
    public int $correct;

    public function __construct(string $answer, int $correct)
    {
        $this->answer = $answer;
        $this->correct = $correct;
    }

    public static function update(object $gameAnswer, object &$dto)
    {
        $dto->id = $gameAnswer->id;
        $dto->game_question_id = $gameAnswer->game_question_id;
        $dto->answer = $gameAnswer->answer;

        if (isset($dto->user_answer)) {
            $gameAnswer->user_answer = $dto->user_answer;
        } else {
            $dto->user_answer = $gameAnswer->user_answer;
        }

        if (isset($dto->user_correct)) {
            $gameAnswer->user_correct = $dto->user_correct;
        } else {
            $dto->user_correct = $gameAnswer->user_correct;
        }
    }

    public static function validate_update(&$dto)
    {
        if (isset($dto->id)) {
            $dto->id = Validator::int('Id', $dto->id);
        } else {
            throw new BadRequest(ERR_REQUIRED, 'Id is required');
        }

        if (isset($dto->user_answer)) {
            $dto->user_answer = Validator::string('User answer', $dto->user_answer, true);
        }

        if (isset($dto->user_correct)) {
            $dto->user_correct = Validator::bool('User correct', $dto->user_correct);
        }
    }
}
