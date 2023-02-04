<?php
require_once('Api/Utils/Database.php');
require_once('Api/Utils/Response.php');
require_once('Api/Quiz/Repo/GameAnswerRepo.php');

class GameAnswerManager
{
    public static function updateAll(Database $db, int $gameQuestionId, array &$gameAnswers, int $type)
    {
        $gameAnswerRepo = new GameAnswerRepo($db);
        foreach ($gameAnswers as &$gameAnswer) {
            $gameAnswerRepo->update($gameAnswer->id, $gameQuestionId, $gameAnswer, $type);
        }
    }
}
