<?php
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Entity/Quiz.php');

class RoleRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function get(): array
    {
        return $this->db->select_all('SELECT * FROM `role`');
    }
}
