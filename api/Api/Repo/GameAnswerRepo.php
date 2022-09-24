<?php
require_once('Api/Utils/Database.php');

class GameAnswerRepo
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function get(int $id, int $gameQuestionId): object
    {
        return $this->db->select('SELECT `id`, `game_question_id`, `answer`, `user_answer`, `user_correct` FROM `game_answer` WHERE `id`=? AND `game_question_id`=?', 'ii', $id, $gameQuestionId);
    }

    public function getByGameQuestionId(int $gameQuestionId, int $type): array
    {
        if ($type == 1 || $type == 2 || $type == 8) {
            $answers = $this->db->select_all('SELECT `id`, `game_question_id`, `answer`, `user_answer`, `user_correct` FROM `game_answer` WHERE `game_question_id`=?', 'i', $gameQuestionId);
            if ($type == 8 && (!isset($answers[0]['user_correct']) || $answers[0]['user_correct'] == 0)) {
                unset($answers[0]['answer']);
            }
            return $answers;
        } else {
            return $this->db->select_all('SELECT `id`, `game_question_id`, `user_answer`, `user_correct` FROM `game_answer` WHERE `game_question_id`=?', 'i', $gameQuestionId);
        }
    }

    public function getByGameQuestionIdResult(int $gameQuestionId): array
    {
        return $this->db->select_all('SELECT * FROM `game_answer` WHERE `game_question_id`=?', 'i', $gameQuestionId);
    }

    public function insert(int $gameQuestionId, object &$gameAnswer)
    {
        $gameAnswer->game_question_id = $gameQuestionId;
        $gameAnswer->id =  $this->db->insert('INSERT INTO `game_answer` (`game_question_id`, `answer`, `correct`) VALUES (?, ?, ?)', 'is', $gameAnswer->game_question_id, $gameAnswer->answer, $gameAnswer->correct);
    }

    public function insertAnswers(int $gameQuizId)
    {
        $this->db->insert(
            'INSERT INTO `game_answer` (`game_question_id`, `answer`, `correct`) 
            SELECT `game_question`.`id`, `answer`.`answer`, `answer`.`correct` 
            FROM `answer` 
            INNER JOIN `question` ON `answer`.`question_id`=`question`.`id` 
            INNER JOIN `game_question` ON `game_question`.`question_id`=`question`.`id`
            WHERE `game_question`.`game_quiz_id`=?',
            'i',
            $gameQuizId
        );
    }

    public function update(int $id, int $gameQuestionId, object &$answer, int $type)
    {
        GameAnswer::update($this->get($id, $gameQuestionId), $answer);
        if ($type == 1 || $type == 2 || $type == 3 || $type == 4 || $type == 8) {
            if (isset($answer->user_correct)) {
                $this->db->update('UPDATE `game_answer` SET `user_correct`=? WHERE `id`=? AND `game_question_id`=?', 'iii', $answer->user_correct, $answer->id, $answer->game_question_id);
            } else {
                $this->db->update('UPDATE `game_answer` SET `user_correct`=NULL WHERE `id`=? AND `game_question_id`=?', 'ii', $answer->id, $answer->game_question_id);
            }
        } else if ($type == 5 || $type == 6 || $type == 7) {
            $this->db->update('UPDATE `game_answer` SET `user_answer`=? WHERE `id`=? AND `game_question_id`=?', 'sii', $answer->user_answer, $answer->id, $answer->game_question_id);
        }
    }
}
