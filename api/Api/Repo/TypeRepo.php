<?php
require_once('Api/Utils/Database.php');
require_once('Api/Entity/Quiz.php');

class TypeRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function get(): array
    {
        return $this->db->select_all('SELECT * FROM `type`');
    }
}
