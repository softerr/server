<?php
require_once('Api/Utils/Database.php');

class LoginTokenRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function insert($userId): int
    {
        $id = $this->db->insert('INSERT INTO `login_token` (`user_id`) VALUES (?)', 'i', $userId);
        return $id;
    }

    public function getTokenById(int $id): string
    {
        return $this->db->select('SELECT `token` FROM `login_token` WHERE `id`=?', 'i', $id)->token;
    }

    public function getUserByToken(string $token): object
    {
        return $this->db->select(
            'SELECT `user`.`id` AS `id`, `user`.`email` AS `email` , `user`.`username` AS `username`, GROUP_CONCAT(`user_role`.`role_id`) AS `roles`, `login_token`.`id` AS `token_id`
            FROM `user` 
                LEFT JOIN `user_role` ON `user`.`id`=`user_role`.`user_id` 
                INNER JOIN `login_token` ON `user`.`id`=`login_token`.`user_id` 
            WHERE `login_token`.`token`=? AND `login_token`.`expired`=0 AND utc_timestamp() BETWEEN `login_token`.`created` AND `login_token`.`expires` 
            GROUP BY `user`.`id`',
            's',
            $token
        );
    }

    public function setExpiredById(int $id)
    {
        $this->db->update('UPDATE `login_token` SET `expired`=1 WHERE `id`=?', 'i', $id);
    }

    public function setExpiredByToken(string $token)
    {
        $this->db->update('UPDATE `login_token` SET `expired`=1 WHERE `token`=?', 's', $token);
    }
}
