<?php
require_once('Utils.php');
require_once('Response.php');
require_once('Lib/jwt.php');
require_once('config.php');

class AuthData
{
    public int $id;
    public string $email;
    public $username;
    public array $roles;

    public function __construct(int $id, string $email, $username, array $roles)
    {
        $this->id = $id;
        $this->email = $email;
        $this->username = $username;
        $this->roles = $roles;
    }
}

class Auth
{
    public static function generateToken(int $id, string $email, $username, array $roles)
    {
        $domain = Utils::get_base_domain();
        $time = time();
        $payload = [
            'iss' => $domain,
            'iat' => $time,
            'nbf' => $time,
            'exp' => $time + 3600,
            'sub' => $id,
            'email' => $email,
            'username' => $username,
            'roles' => $roles
        ];
        return JWT::encode($payload, JWT_KEY, 'HS256');
    }

    public static function authenticate(): AuthData
    {
        $token = Utils::get_bearer_token();
        if (!isset($token)) {
            throw new Unauthorized(ERR_AUTH_NO_ACCESS_TOKEN);
        }

        try {
            $payload = JWT::decode($token, JWT_KEY, ['HS256']);
        } catch (ExpiredException $e) {
            throw new Unauthorized(ERR_EXPIRED_TOKEN);
        } catch (Exception $e) {
            throw new Unauthorized(ERR_AUTH_INVALID_TOKEN, 'Invalid token: ' . $e->getMessage());
        }

        return new AuthData($payload->sub, $payload->email, $payload->username, $payload->roles);
    }
}
