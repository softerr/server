<?php
class Utils
{
    public static function get_base_domain(): string
    {
        return $_SERVER['SERVER_NAME'];
    }
    public static function get_method(): string
    {
        return $_SERVER['REQUEST_METHOD'];
    }
    public static function get_uri(): string
    {
        return $_SERVER['REQUEST_URI'];
    }
    public static function is_content_type(string $content_type): bool
    {
        return array_key_exists('CONTENT_TYPE', $_SERVER) && $_SERVER['CONTENT_TYPE'] == $content_type;
    }
    public static function is_method(string $method): bool
    {
        return $_SERVER['REQUEST_METHOD'] == $method;
    }

    public static function get_authorization_header()
    {
        $headers = null;
        if (isset($_SERVER['Authorization'])) {
            $headers = trim($_SERVER["Authorization"]);
        } else if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $headers = trim($_SERVER["HTTP_AUTHORIZATION"]);
        } elseif (function_exists('apache_request_headers')) {
            $requestHeaders = apache_request_headers();
            $requestHeaders = array_combine(array_map('ucwords', array_keys($requestHeaders)), array_values($requestHeaders));
            if (isset($requestHeaders['Authorization'])) {
                $headers = trim($requestHeaders['Authorization']);
            }
        }
        return $headers;
    }

    public static function get_bearer_token()
    {
        $headers = self::get_authorization_header();
        if (empty($headers)) {
            return null;
        }

        if (preg_match('/Bearer\s(\S+)/', $headers, $matches)) {
            return $matches[1];
        }

        return null;
    }

    public static function read_file(string $filename): string
    {
        $file = fopen($filename, "r");
        if ($file == false) {
            throw new InternalServerError(ERR_DB_CONNECT, "Error in opening file");
        }
        $cs = fread($file, filesize($filename));
        fclose($file);
        return $cs;
    }
}
