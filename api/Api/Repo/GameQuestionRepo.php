<?php
require_once('Api/Utils/Database.php');

class GameQuestionRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function getId(int $id, $gameQuizId): object
    {
        return $this->db->select('SELECT `id`, `type_id` FROM `game_question` WHERE `id`=? AND game_quiz_id=?', 'ii', $id, $gameQuizId);
    }

    public function getByGameQuizId(int $gameQuizId): array
    {
        return $this->db->select_all('SELECT * FROM `game_question` WHERE `game_quiz_id`=?', 'i', $gameQuizId);
    }

    public function insert(int $gameQuizId, object &$gameQuestion)
    {
        $gameQuestion->game_quiz_id = $gameQuizId;
        $gameQuestion->id =  $this->db->insert('INSERT INTO `game_question` (`game_quiz_id`, `question`) VALUES (?, ?)', 'is', $gameQuestion->game_quiz_id, $gameQuestion->question);
    }

    public function insertQuestions(int $gameQuizId)
    {
        $this->db->insert(
            'INSERT INTO `game_question` (`game_quiz_id`, `question_id`, `type_id`, `question`)
            SELECT `game_quiz`.`id`, `question`.`id`, `question`.`type_id`, `question`.`question` 
            FROM `question` 
            INNER JOIN `game_quiz` ON `game_quiz`.`quiz_id`=`question`.`quiz_id`
            WHERE `game_quiz`.`id`=?',
            'i',
            $gameQuizId,
        );
    }
}
