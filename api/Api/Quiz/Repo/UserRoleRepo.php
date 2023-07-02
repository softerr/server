<?php
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Entity/QuizUserRole.php');

class UserRoleRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function get(int $id, int $userId): object
    {
        return $this->db->select('SELECT * FROM `user_role` WHERE `id`=? AND `user_id`=?', 'ii', $id, $userId);
    }

    public function getByUserId($userId): array
    {
        return $this->db->select_all('SELECT * FROM `user_role` WHERE `user_id`=?', 'i', $userId);
    }

    public function insert(int $userId, object &$userRole)
    {
        $userRole->user_id = $userId;
        $userRole->id = $this->db->insert('INSERT INTO `user_role` (`user_id`, `role_id`) VALUES (?, ?)', 'ii', $userRole->user_id, $userRole->role_id);
    }

    public function insertRoleIfNotExists(int $userId, int $roleId)
    {
        $this->db->insert(
            'INSERT INTO `user_role` (`user_id`, `role_id`) SELECT ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM `user_role` WHERE `user_id` = ?)',
            'iii',
            $userId, $roleId, $userId
        );
    }

    public function update(int $id, int $userId, object &$userRole)
    {
        QuizUserRole::update($this->get($id, $userId), $userRole);
        $this->db->update('UPDATE `user_role` SET `role_id`=? WHERE `id`=? AND `user_id`=?', 'iii', $userRole->role_id, $userRole->id, $userRole->user_id);
    }

    public function delete(int $id, int $userId)
    {
        $userRole = $this->get($id, $userId);
        $this->db->delete('DELETE FROM `user_role` WHERE `id`=? AND `user_id`=?', 'ii', $userRole->id, $userRole->user_id);
    }
}
