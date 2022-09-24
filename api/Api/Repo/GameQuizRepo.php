<?php
require_once('Api/Utils/Database.php');

class GameQuizRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function get(int $id, int $userId, int $quizId): object
    {
        return $this->db->select('SELECT * FROM `game_quiz` WHERE `id`=? AND `user_id`=? AND quiz_id=?', 'iii', $id, $userId, $quizId);
    }

    public function getNotEnded(int $id, int $userId, int $quizId)
    {
        return $this->db->select('SELECT `id`, `current_question` FROM `game_quiz` WHERE `id`=? AND `user_id`=? AND quiz_id=? AND `end` IS NULL', 'iii', $id, $userId, $quizId);
    }

    public function insert(int $userId, int $quizId, object &$gameQuiz)
    {
        $gameQuiz->user_id = $userId;
        $gameQuiz->quiz_id = $quizId;
        $gameQuiz->id =  $this->db->insert('INSERT INTO `game_quiz` (`user_id`, `quiz_id`) VALUES (?, ?)', 'ii', $gameQuiz->user_id, $gameQuiz->quiz_id);
        $gameQuiz = $this->db->select('SELECT * FROM `game_quiz` WHERE `id`=? AND `user_id`=? AND `quiz_id`=?', 'iii', $gameQuiz->id, $gameQuiz->user_id, $gameQuiz->quiz_id);
    }

    public function update(int $id, int $userId, int $quizId, object &$gameQuiz)
    {
        GameQuiz::update($this->get($id, $userId, $quizId), $gameQuiz);
        if (isset($gameQuiz->end) && $gameQuiz->end) {
            $this->db->update('UPDATE `game_quiz` SET `current_question`=NULL, `end`=utc_timestamp() WHERE `id`=? AND `user_id`=? AND `quiz_id`=? AND `end` IS NULL ', 'iii', $gameQuiz->id, $gameQuiz->user_id, $gameQuiz->quiz_id);
        } else {
            $this->db->update('UPDATE `game_quiz` SET `current_question`=? WHERE `id`=? AND `user_id`=? AND `quiz_id`=? AND `end` IS NULL', 'iiii', $gameQuiz->current_question, $gameQuiz->id, $gameQuiz->user_id, $gameQuiz->quiz_id);
        }
        $gameQuiz = $this->db->select('SELECT * FROM `game_quiz` WHERE `id`=? AND `user_id`=? AND `quiz_id`=?', 'iii', $gameQuiz->id, $gameQuiz->user_id, $gameQuiz->quiz_id);
    }
}
