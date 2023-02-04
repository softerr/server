<?php
require_once('Api/Utils/Database.php');
require_once('Api/Quiz/Entity/Quiz.php');

class ImageRepo
{
    private Database $db;
    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function insert(object &$image, string $folder, string $ext)
    {
        $image->id = $this->db->insert('INSERT INTO `image` () VALUES ()');
        $image->path = $folder . $image->id . '.' . $ext;
        $this->db->update('UPDATE `image` SET `path`=? WHERE `id`=?', 'si', $image->path, $image->id);
    }
}
