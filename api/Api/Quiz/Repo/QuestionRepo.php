<?php
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Entity/Question.php');

class QuestionRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    private function get(int $id, int $quizId): object
    {
        return $this->db->select(
            'SELECT `question`.*, `type`.`label` AS `type_label` 
            FROM `question` 
            INNER JOIN `type` ON `type`.`id`=`question`.`type_id`
            WHERE `question`.`id`=? AND `question`.`quiz_id`=?',
            'ii',
            $id,
            $quizId
        );
    }

    public function getId(int $id, int $quizId): object
    {
        return $this->db->select('SELECT `id`, `type_id` FROM `question` WHERE `id`=? AND `quiz_id`=?', 'ii', $id, $quizId);
    }

    public function getByQuizId(int $quizId): array
    {
        return $this->db->select_all(
            'SELECT `question`.*, `type`.`label` AS `type_label` 
            FROM `question` 
            INNER JOIN `type` ON `type`.`id`=`question`.`type_id`
            WHERE `quiz_id`=?',
            'i',
            $quizId
        );
    }

    public function insert(int $quizId, object &$question)
    {
        $question->quiz_id = $quizId;
        $question->id = $this->db->insert('INSERT INTO `question` (`quiz_id`, `type_id`, `question`) VALUES (?, ?, ?)', 'iis', $question->quiz_id, $question->type_id, $question->question);
    }

    public function update(int $id, int $quizId, object &$question)
    {
        Question::update($this->get($id, $quizId), $question);
        $this->db->update('UPDATE `question` SET `type_id`=?, `question`=? WHERE `id`=? AND `quiz_id`=?', 'isii', $question->type_id, $question->question, $question->id, $question->quiz_id);
        $question->type_label = $this->get($id, $quizId)->type_label;
    }

    public function delete(int $id, int $quizId)
    {
        $question = $this->get($id, $quizId);
        $this->db->delete('DELETE FROM `question` WHERE `id`=? AND `quiz_id`=?', 'ii', $question->id, $question->quiz_id);
    }
}
