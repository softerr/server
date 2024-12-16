<?php
require_once('Response.php');

class Router
{
    private static function matches(string $uri, string $pattern, array &$matches): bool
    {
        return boolval(preg_match_all("#^$pattern#", $uri, $matches, PREG_PATTERN_ORDER));
    }

    public static function prefix(string $uri, string $pattern, callable $fn, ...$args)
    {
        $params = [];
        if (!self::matches($uri, $pattern, $params)) {
            return null;
        }

        $params = array_map(fn($match) => $match[0], $params);
        $uri = substr($uri, strlen(array_shift($params)));
        return call_user_func_array($fn, array_merge([$uri], $args, $params));
    }

    public static function resolve(string $uri, string $pattern, string $class, array $methods, ...$args)
    {
        $params = [];
        if (!self::matches($uri, "$pattern$", $params)) {
            return null;
        }

        $method = Utils::get_method();
        if ($method == 'OPTIONS') {
            throw new OptionsResponse();
        }
        if (!array_key_exists($method, $methods)) {
            throw new MethodNotAllowed(ERR_METHOD_NOT_ALLOWED, array_keys($methods));
        }

        array_shift($params);
        $params = array_map(fn($match) => $match[0], $params);

        $dto = null;
        if ($method == 'POST' || $method == 'PUT' || $method == 'PATCH') {
            $contents = file_get_contents('php://input');
            if (strlen($contents) > 0) {
                if (!Utils::is_content_type('application/json')) {
                    throw new UnsupportedMediaType(ERR_UNSUPPORTED_CONTENT_FORMAT);
                }

                $dto = json_decode($contents);
                if ($dto == null) {
                    throw new BadRequest(ERR_BAD_JSON_FORMAT);
                }
            }
        }
        return call_user_func_array([$class, $methods[$method]], array_merge([$dto], $args, $params));
    }
}
