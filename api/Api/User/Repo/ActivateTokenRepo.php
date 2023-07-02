<?php
require_once('Api/Utils/Database.php');

class ActivateTokenRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function insert($userId): int
    {
        $id = $this->db->insert('INSERT INTO `activate_token` (`user_id`) VALUES (?)', 'i', $userId);
        return $id;
    }

    public function getTokenById(int $id): string
    {
        return $this->db->select('SELECT `token` FROM `activate_token` WHERE `id`=?', 'i', $id)->token;
    }

    public function getUserByToken(string $token): object
    {
        return $this->db->select(
            'SELECT `user`.`id` AS `id`, `user`.`email` AS `email` , `user`.`username` AS `username`, GROUP_CONCAT(`user_role`.`role_id`) AS `roles`, `activate_token`.`id` AS `token_id`
            FROM `user` 
                LEFT JOIN `user_role` ON `user`.`id`=`user_role`.`user_id` 
                INNER JOIN `activate_token` ON `user`.`id`=`activate_token`.`user_id` 
            WHERE `activate_token`.`token`=? AND `activate_token`.`expired`=0 AND utc_timestamp() >= `activate_token`.`created`
            GROUP BY `user`.`id`',
            's',
            $token
        );
    }

    public function setExpired(int $id)
    {
        $this->db->update('UPDATE `activate_token` SET `expired`=1 WHERE `id`=?', 'i', $id);
    }
}
