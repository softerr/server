<?php
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Entity/Answer.php');

class AnswerRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function get(int $id, int $questionId): object
    {
        return $this->db->select('SELECT * FROM `answer` WHERE `id`=? AND `question_id`=?', 'ii', $id, $questionId);
    }

    public function getId(int $id, int $questionId): object
    {
        return $this->db->select('SELECT `id` FROM `answer` WHERE `id`=? AND `question_id`=?', 'ii', $id, $questionId);
    }

    public function getByQuestionId(int $questionId): array
    {
        return $this->db->select_all('SELECT * FROM `answer` WHERE `question_id`=?', 'i', $questionId);
    }

    public function insert(int $questionId, object &$answer)
    {
        $answer->question_id = $questionId;
        $answer->id = $this->db->insert('INSERT INTO `answer` (`question_id`, `answer`, `correct`) VALUES (?, ?, ?)', 'isi', $answer->question_id, $answer->answer, $answer->correct);
    }

    public function update(int $id, int $questionId, object &$answer, int $type)
    {
        Answer::update($this->get($id, $questionId), $answer);
        if ($type == 1 || $type == 2) {
            $this->db->update('UPDATE `answer` SET `answer`=?, correct=? WHERE `id`=? AND `question_id`=?', 'siii', $answer->answer, $answer->correct, $answer->id, $answer->question_id);
        } else if ($type == 3 || $type == 4) {
            $this->db->update('UPDATE `answer` SET `answer`=NULL, correct=? WHERE `id`=? AND `question_id`=?', 'iii', $answer->correct, $answer->id, $answer->question_id);
            $answer->answer = NULL;
        } else if ($type == 5 || $type == 7 || $type == 8) {
            $this->db->update('UPDATE `answer` SET `answer`=?, correct=NULL WHERE `id`=? AND `question_id`=?', 'sii', $answer->answer, $answer->id, $answer->question_id);
            $answer->correct = NULL;
        } else if ($type == 6) {
            $this->db->update('UPDATE `answer` SET `answer`=NULL, correct=NULL WHERE `id`=? AND `question_id`=?', 'ii', $answer->id, $answer->question_id);
            $answer->answer = NULL;
            $answer->correct = NULL;
        }
    }

    public function delete(int $id, int $questionId)
    {
        $answer = $this->get($id, $questionId);
        $this->db->delete('DELETE FROM `answer` WHERE `id`=? AND `question_id`=?', 'ii', $answer->id, $answer->question_id);
    }
}
