<?php
require_once('Response.php');

class Validator
{
    public static function int(string $name, $value): int
    {
        if (!is_int($value)) {
            throw new BadRequest(ERR_INT, "$name is not an integer");
        }
        return $value;
    }

    public static function bool(string $name, $value): int
    {
        if (is_bool($value)) {
            return (int)$value;
        }

        if (is_int($value)) {
            if ($value === 0 || $value === 1) {
                return $value;
            } else {
                throw new BadRequest(ERR_0_OR_1, "$name can only be 0 or 1");
            }
        }

        throw new BadRequest(ERR_BOOL, "$name is not a bool");
    }

    public static function string(string $name, $value, bool $empty = false): string
    {
        if (!is_string($value)) {
            throw new BadRequest(ERR_STRING, "$name is not a string");
        }

        if (!$empty && strlen($value) == 0) {
            throw new BadRequest(ERR_EMPTY, "$name is empty");
        }

        if (strlen(trim($value)) != strlen($value)) {
            throw new BadRequest(ERR_SPACE, "$name cannot start or end with a space");
        }

        return $value;
    }

    public static function object(string $name, &$value)
    {
        if (gettype($value) !== 'object') {
            throw new BadRequest(ERR_OBJECT, "$name is not an object");
        }
    }

    public static function id(string $name, $value): int
    {
        return self::int($name, $value);
    }

    public static function email(string $name, $value): string
    {
        $value = self::string($name, $value);

        if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
            throw new BadRequest(ERR_EMAIL, "$name format is not valid");
        }

        return $value;
    }

    public static function password(string $name, $value): string
    {
        $value = self::string($name, $value);

        if (strlen($value) < 8) {
            throw new BadRequest(ERR_LENGTH, "$name must be at least 8 characters long");
        }

        return $value;
    }

    public static function password2(string $name, $value): string
    {
        $value = self::string($name, $value);

        if (strlen($value) < 8) {
            throw new BadRequest(ERR_USR_LOGIN);
        }

        return $value;
    }

    public static function time(string $name, $value): int
    {
        return self::int($name, $value);
    }

    public static function image($image)
    {
        $name = $image['name'];
        $size = $image['size'];

        $ext = pathinfo($name, PATHINFO_EXTENSION);

        $validExt = array('jpeg', 'jpg', 'png', 'gif');

        if (!in_array($ext, $validExt)) {
            throw new UnprocessableEntity(ERR_IMG_FORMAT);
        }

        if ($size > 5 * 1024 * 1024) {
            throw new UnprocessableEntity(ERR_IMG_SIZE);
        }
    }
}
