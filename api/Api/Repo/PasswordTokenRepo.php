<?php
require_once('Api/Utils/Database.php');

class PasswordTokenRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function insert($userId): int
    {
        $id = $this->db->insert('INSERT INTO `password_token` (`user_id`) VALUES (?)', 'i', $userId);
        return $id;
    }

    public function getTokenById(int $id): string
    {
        return $this->db->select('SELECT `token` FROM `password_token` WHERE `id`=?', 'i', $id)->token;
    }

    public function getUserByToken(string $token): object
    {
        return $this->db->select(
            'SELECT `user`.`id` AS `id`, `user`.`email` AS `email` , `user`.`username` AS `username`, GROUP_CONCAT(`user_role`.`role_id`) AS `roles`, `password_token`.`id` AS `token_id`
            FROM `user` 
                LEFT JOIN `user_role` ON `user`.`id`=`user_role`.`user_id` 
                INNER JOIN `password_token` ON `user`.`id`=`password_token`.`user_id` 
            WHERE `password_token`.`token`=? AND `password_token`.`expired`=0 AND utc_timestamp() BETWEEN `password_token`.`created` AND `password_token`.`expires` 
            GROUP BY `user`.`id`',
            's',
            $token
        );
    }

    public function setUsed(int $id)
    {
        $this->db->update('UPDATE `password_token` SET `used`=1 WHERE `id`=?', 'i', $id);
    }

    public function setExpired(int $id)
    {
        $this->db->update('UPDATE `password_token` SET `expired`=1 WHERE `id`=?', 'i', $id);
    }
}
