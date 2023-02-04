<?php
require_once('Api/Utils/Router.php');
require_once('Api/Utils/Validator.php');
require_once('Api/Image/Repo/ImageRepo.php');

class ImageController
{
    public static function route($uri)
    {
        Router::prefix($uri, '/image', function ($uri) {
            Router::resolve($uri, '', ImageController::class, ['POST' => 'create']);
        });
    }

    public static function create($dto)
    {
        $dto = (object)[];
        $image = $_FILES['sendimage'];

        Validator::image($image);

        $fileName = $image['name'];
        $tempPath = $image['tmp_name'];
        $ext = pathinfo($fileName, PATHINFO_EXTENSION);

        $db = new Database();
        $imageRepo = new ImageRepo($db);
        $imageRepo->insert($dto, 'D:/dev/server/image/', $ext);

        move_uploaded_file($tempPath, $dto->path);

        throw new Created($dto);
    }
}
