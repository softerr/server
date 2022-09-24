<?php

require_once('Api/Utils/Validator.php');
require_once('Api/Utils/Response.php');

class GameQuestion
{
    public int $id;
    public int $game_quiz_id;
    public string $question;

    public function __construct(string $question)
    {
        $this->question = $question;
    }
}
