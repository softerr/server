<?php

require_once('Api/Utils/Validator.php');

class Image
{
    public static function validate_insert($image)
    {
        Validator::image($image);
    }
}
