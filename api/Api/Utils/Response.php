<?php

define('ERR_USR_FORBIDDEN', 1);
define('ERR_USR_REQUIRED_EMAIL_USERNAME', 2);
define('ERR_USR_LOGIN', 3);
define('ERR_USR_EMAIL_EXISTS', 4);
define('ERR_USR_USERNAME_EXISTS', 5);

define('ERR_AUTH_NO_REFRESH_TOKEN', 6);
define('ERR_AUTH_EXPIRED_REFRESH_TOKEN', 7);
define('ERR_AUTH_NO_ACCESS_TOKEN', 8);
define('ERR_EXPIRED_TOKEN', 9);
define('ERR_AUTH_INVALID_TOKEN', 10);

define('ERR_DB_CONNECT', 11);
define('ERR_DB_PREPARE', 12);
define('ERR_DB_BIND_PARAM', 13);
define('ERR_DB_EXECUTE', 14);
define('ERR_DB_GET_RESULT', 15);
define('ERR_DB_RESET', 16);
define('ERR_DB_BEGIN_TRANSACTION', 17);
define('ERR_DB_COMMIT', 18);
define('ERR_DB_INSERT', 19);

define('ERR_NOT_FOUND', 20);
define('ERR_METHOD_NOT_ALLOWED', 21);
define('ERR_UNSUPPORTED_CONTENT_FORMAT', 22);
define('ERR_BAD_JSON_FORMAT', 23);
define('ERR_NO_DATA', 24);

define('ERR_INT', 25);
define('ERR_BOOL', 26);
define('ERR_STRING', 27);
define('ERR_ARRAY', 28);
define('ERR_OBJECT', 29);
define('ERR_EMPTY', 30);
define('ERR_SPACE', 31);
define('ERR_LENGTH', 32);
define('ERR_EMAIL', 33);
define('ERR_0_OR_1', 34);

define('ERR_REQUIRED', 35);

define('ERR_NOT_CURRENT_QUESTION', 36);

define('ERR_SEND_EMAIL', 37);

class ErrorResponseBody
{
    public int $status;
    public string $error;
    public int $code;
    public string $message;

    public function __construct(int $status, string $error, int $code, string $message = null)
    {
        $this->status = $status;
        $this->error = $error;
        $this->code = $code;
        if (isset($message)) {
            $this->message = $message;
        }
    }
}

class MethodErrorResponseBody extends ErrorResponseBody
{
    public array $allow;

    public function __construct(int $status, string $error, int $code, array $allow, string $message = null)
    {
        parent::__construct($status, $error, $code, $message);
        $this->allow = $allow;
    }
}

abstract class Response extends Exception
{
    private int $response_code;
    private $body;

    public function __construct(int $response_code, $body)
    {
        $this->response_code = $response_code;
        $this->body = $body;
    }

    public function show(): void
    {
        header("Content-Type: application/json; charset=utf-8");
        http_response_code($this->response_code);
        echo json_encode($this->body);
    }
}
class Ok extends Response
{
    public function __construct($resource)
    {
        parent::__construct(200, $resource);
    }
}
class Created extends Response
{
    public function __construct($resource)
    {
        parent::__construct(201, $resource);
    }
}
class NoContent extends Response
{
    public function __construct()
    {
        parent::__construct(204, null);
    }
}
class BadRequest extends Response
{
    public function __construct(int $code, string $message = null)
    {
        parent::__construct(400, new ErrorResponseBody(400, "Bad Request", $code, $message));
    }
}
class Unauthorized extends Response
{
    public function __construct(int $code, string $message = null)
    {
        parent::__construct(401, new ErrorResponseBody(401, "Unauthorized", $code, $message));
    }
}
class Forbidden extends Response
{
    public function __construct(int $code, string $message = null)
    {
        parent::__construct(403, new ErrorResponseBody(403, "Forbidden", $code, $message));
    }
}
class NotFound extends Response
{
    public function __construct(int $code, string $message = null)
    {
        parent::__construct(404, new ErrorResponseBody(404, "Not Found", $code, $message));
    }
}
class MethodNotAllowed extends Response
{
    public function __construct(int $code, array $allow, string $message = null)
    {
        parent::__construct(405, new MethodErrorResponseBody(405, "Method Not Allowed", $code, $allow, $message));
    }
}
class UnsupportedMediaType extends Response
{
    public function __construct(int $code, string $message = null)
    {
        parent::__construct(415, new ErrorResponseBody(415, "Unsupported Media Type", $code, $message));
    }
}
class InternalServerError extends Response
{
    public function __construct(int $code, string $message = null)
    {
        parent::__construct(500, new ErrorResponseBody(500, "Internal Server Error", $code, $message));
    }
}
class NotImplemented extends Response
{
    public function __construct(int $code, string $message = null)
    {
        parent::__construct(501, new ErrorResponseBody(501, "Not Implemented", $code, $message));
    }
}
