<?php
require_once('Api/Utils/Database.php');
require_once('Api/Entity/Quiz.php');

class QuizRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function get(int $id, int $userId): object
    {
        return $this->db->select('SELECT * FROM `quiz` WHERE `id`=? AND `user_id`=?', 'ii', $id, $userId);
    }

    public function getId(int $id, int $userId): object
    {
        return $this->db->select('SELECT `id` FROM `quiz` WHERE `id`=? AND `user_id`=?', 'ii', $id, $userId);
    }

    public function getPublicId(int $id): object
    {
        return $this->db->select('SELECT `id` FROM `quiz` WHERE `id`=? AND `public`=1', 'i', $id);
    }

    public function getPublic(int $id): object
    {
        return $this->db->select('SELECT * FROM `quiz` WHERE `id`=? AND `public`=1', 'i', $id);
    }

    public function getByUserId(int $userId): array
    {
        return $this->db->select_all(
            'SELECT `quiz`.*, COUNT(distinct `question`.`id`) AS `question_count`
            FROM `quiz` 
            LEFT JOIN `question` ON `question`.`quiz_id` = `quiz`.`id`
            WHERE `quiz`.`user_id`=? 
            GROUP BY `quiz`.`id`',
            'i',
            $userId
        );
    }

    public function getPublicQuizzes()
    {
        return $this->db->select_all(
            'SELECT `quiz`.*, COUNT(distinct `game_quiz`.`id`) AS `games`, COUNT(distinct `question`.`id`) AS `question_count`
            FROM `quiz` 
            LEFT JOIN `game_quiz` ON `game_quiz`.`quiz_id` = `quiz`.`id`
            LEFT JOIN `question` ON `question`.`quiz_id` = `quiz`.`id`
            WHERE `public`=1 AND `status`!=-1
            GROUP BY `quiz`.`id`
            ORDER BY `games` DESC'
        );
    }

    public function getModQuizzes()
    {
        return $this->db->select_all(
            'SELECT `quiz`.*, COUNT(distinct `game_quiz`.`id`) AS `games`, COUNT(distinct `question`.`id`) AS `question_count`
            FROM `quiz` 
            LEFT JOIN `game_quiz` ON `game_quiz`.`quiz_id` = `quiz`.`id`
            LEFT JOIN `question` ON `question`.`quiz_id` = `quiz`.`id`
            WHERE `public`=1
            GROUP BY `quiz`.`id`
            ORDER BY `games` DESC'
        );
    }

    public function insert(int $userId, object &$quiz)
    {
        $quiz->user_id = $userId;
        $quiz->question_count = 0;
        $quiz->id = $this->db->insert('INSERT INTO `quiz` (`user_id`, `name`, `description`, `public`) VALUES (?, ?, ?, ?)', 'issi', $quiz->user_id, $quiz->name, $quiz->description, $quiz->public);
    }

    public function update(int $id, int $userId, object &$quiz)
    {
        Quiz::update($this->get($id, $userId), $quiz);
        $this->db->update('UPDATE `quiz` SET `name`=?, `description`=?, `public`=? WHERE `id`=? AND `user_id`=?', 'ssiii', $quiz->name, $quiz->description, $quiz->public, $quiz->id, $quiz->user_id);
    }

    public function updatePublic(int $id, object &$quiz)
    {
        Quiz::update_public($this->getPublic($id), $quiz);
        $this->db->update('UPDATE `quiz` SET `status`=? WHERE `id`=? AND `public`=1', 'ii', $quiz->status, $quiz->id);
    }

    public function delete(int $id, int $userId)
    {
        $quiz = $this->get($id, $userId);
        $this->db->delete('DELETE FROM `quiz` WHERE `id`=? AND `user_id`=?', 'ii', $quiz->id, $quiz->user_id);
    }
}
