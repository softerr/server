<?php
require_once('Api/Utils/Database.php');
require_once('Api/Utils/Response.php');
require_once('Api/Quiz/Repo/AnswerRepo.php');

class AnswerManager
{
    public static function insert(Database $db, int $questionId, object &$answer)
    {
        $answerRepo = new AnswerRepo($db);
        $answerRepo->insert($questionId, $answer);
    }

    public static function update(Database $db, int $id, int $questionId, object &$answer, int $type)
    {
        $answerRepo = new AnswerRepo($db);
        $answerRepo->update($id, $questionId, $answer, $type);
    }

    public static function delete(Database $db, int $id, int $questionId)
    {
        $answerRepo = new AnswerRepo($db);
        $answerRepo->delete($id, $questionId);
    }
}
