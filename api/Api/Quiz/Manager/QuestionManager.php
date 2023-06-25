<?php
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Repo/QuestionRepo.php');
require_once('Api/Quiz/Repo/AnswerRepo.php');

class QuestionManager
{
    public static function insert(Database $db, int $quizId, object &$question)
    {
        $questionRepo = new QuestionRepo($db);
        $questionRepo->insert($quizId, $question);
        if (isset($question->answers)) {
            $answerRepo = new AnswerRepo($db);
            foreach ($question->answers as &$answer) {
                $answerRepo->insert($question->id, $answer);
            }
        }
    }

    public static function update(Database $db, int $id, int $quizId, object &$question)
    {
        $questionRepo = new QuestionRepo($db);
        $questionRepo->update($id, $quizId, $question);
        if (isset($question->answers)) {
            $answerRepo = new AnswerRepo($db);
            $answers = $answerRepo->getByQuestionId($id);
            $n = 0;
            for ($i = 0; $i < count($question->answers) && $i < count($answers); $i++) {
                $answerRepo->update($answers[$i]['id'], $id, $question->answers[$i], $question->type_id);
                $n++;
            }

            for ($i = $n; $i < count($answers); $i++) {
                $answerRepo->delete($answers[$i]['id'], $id);
            }

            for ($i = $n; $i < count($question->answers); $i++) {
                $answerRepo->insert($id, $question->answers[$i]);
            }
        }
    }

    public static function delete(Database $db, int $id, int $quizId)
    {
        $questionRepo = new QuestionRepo($db);
        $questionRepo->delete($id, $quizId);
    }
}
