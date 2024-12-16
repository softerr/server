<?php
require_once('Utils/Database.php');

class UserRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function get(): array
    {
        return $this->db->select_all(
            'SELECT `user`.`id` AS `id`, `user`.`email` AS `email`, `user`.`username` AS `username`, GROUP_CONCAT(`user_role`.`role_id`) AS `roles`, GROUP_CONCAT(`role`.`name`) AS `roles_names` 
             FROM `user`
                LEFT JOIN `user_role` ON `user`.`id`=`user_role`.`user_id` 
                INNER JOIN `role` ON `user_role`.`role_id`=`role`.`id` 
             GROUP BY `user`.`id`',
        );
    }

    public function getId(int $id): object
    {
        return $this->db->select('SELECT `id` FROM `user` WHERE `id`=?', 'i', $id);
    }

    public function getById(int $id)
    {
        return $this->db->select(
            'SELECT `user`.`id` AS `id`, `user`.`email` AS `email`, `user`.`username` AS `username`, `user`.`password` AS `password`, GROUP_CONCAT(`user_role`.`role_id`) AS `roles` 
             FROM `user`
                LEFT JOIN `user_role` ON `user`.`id`=`user_role`.`user_id` 
             WHERE `user`.`id`=? 
             GROUP BY `user`.`id`',
            'i',
            $id
        );
    }

    public function getByEmail(string $roles_db, string $email): object
    {
        return $this->db->select(
            "SELECT `user`.`id` AS `id`, `user`.`email` AS `email`, `user`.`username` AS `username`, `user`.`password` AS `password`, GROUP_CONCAT(`user_role`.`role_id`) AS `roles` 
             FROM `user`
                LEFT JOIN `$roles_db`.`user_role` ON `user`.`id`=`user_role`.`user_id` 
             WHERE `user`.`email`=? AND `activated`=1 
             GROUP BY `user`.`id`",
            's',
            $email
        );
    }

    public function getCountByEmail(string $email): int
    {
        return $this->db->select('SELECT COUNT(1) AS `count` FROM `user` WHERE `email`=?', 's', $email)->count;
    }

    public function getCountByUsername(string $username): int
    {
        return $this->db->select('SELECT COUNT(1) AS `count` FROM `user` WHERE `username`=?', 's', $username)->count;
    }

    public function insert(array $roles, object $dto): object
    {
        $user = new User($dto);
        $this->db->begin_transaction();
        $user->id = $this->db->insert('INSERT INTO `user` (`email`, `username`, `password`) VALUES (?, ?, ?)', 'sss', $user->email, $user->username, password_hash($dto->password, PASSWORD_BCRYPT));
        $this->db->insert('INSERT INTO `user_role` (`user_id`, `role_id`) VALUES (?, ?)', 'ii', $user->id, $roles[0]);
        $this->db->commit();
        $user->roles = $roles;
        return $user;
    }

    public function update(int $id, object &$user)
    {
        User::update($this->getById($id), $user);
        $this->db->update('UPDATE `user` SET `email`=?, `username`=? WHERE `id`=?', 'ssi', $user->email, $user->username, $user->id);
    }

    public function updatePassword(int $id, object &$user)
    {
        User::update($this->getById($id), $user);
        $this->db->update('UPDATE `user` SET `password`=? WHERE `id`=?', 'si', password_hash($user->password, PASSWORD_BCRYPT), $user->id);
    }

    public function delete(int $id)
    {
        $user = $this->getById($id);
        $this->db->delete('DELETE FROM `user` WHERE `id`=?', 'i', $user->id);
    }

    public function activate(int $id)
    {
        $this->db->update('UPDATE `user` SET `activated`=1 WHERE `id`=?', 'i', $id);
    }
}
