<?php
require_once('Response.php');
require_once('Utils.php');
require_once('config.php');

class Database
{
    private mysqli $conn;

    public function __construct(string $db)
    {
        try {
            $conn = mysqli_connect(MYSQL_PHP_HOST, MYSQL_PHP_USER, MYSQL_PHP_PASS, $db, MYSQL_PHP_PORT);
            if (!$conn) {
                throw new InternalServerError(ERR_DB_CONNECT, mysqli_connect_error());
            }
            $this->conn = $conn;
        } catch (mysqli_sql_exception $e) {
            throw new InternalServerError(ERR_DB_CONNECT, $e->getMessage());
        }
    }

    public function __destruct()
    {
        $this->conn->close();
    }

    private function query(string $sql, callable $func, string $types = NULL, $var1 = NULL, ...$vars)
    {
        $stmt = $this->conn->stmt_init();
        if (!$stmt->prepare($sql)) {
            throw new InternalServerError(ERR_DB_PREPARE, $stmt->errno . ': ' . $stmt->error);
        }
        if (!is_null($types) && !empty($types) && !is_null($var1)) {
            if (!$stmt->bind_param($types, $var1, ...$vars)) {
                throw new InternalServerError(ERR_DB_BIND_PARAM, $stmt->errno . ': ' . $stmt->error);
            }
        }
        if (!$stmt->execute()) {
            throw new InternalServerError(ERR_DB_EXECUTE, $stmt->errno . ': ' . $stmt->error);
        }
        $val = $func($stmt);
        $stmt->close();
        return $val;
    }

    private function select_query(string $sql, callable $func, string $types = NULL, $var1 = NULL, ...$vars)
    {
        return self::query($sql, function (mysqli_stmt $stmt) use ($func) {
            $result = $stmt->get_result();
            if (!$result) {
                throw new InternalServerError(ERR_DB_GET_RESULT, $stmt->errno . ': ' . $stmt->error);
            }
            $val = $func($result);
            $result->free();
            return $val;
        }, $types, $var1, ...$vars);
    }

    private function action_query(string $sql, string $types = NULL, $var1 = NULL, ...$vars)
    {
        return $this->query($sql, function () {}, $types, $var1, ...$vars);
    }

    public function select(string $sql, string $types = NULL, $var1 = NULL, ...$vars): object
    {
        return $this->select_query($sql, function (mysqli_result $result) {
            $row = $result->fetch_object();
            if (!$row) {
                throw new NotFound(ERR_NOT_FOUND);
            }
            return $row;
        }, $types, $var1, ...$vars);
    }

    public function select_all(string $sql, string $types = NULL, $var1 = NULL, ...$vars): array
    {
        return $this->select_query($sql, function (mysqli_result $result) {
            return $result->fetch_all(MYSQLI_ASSOC);
        }, $types, $var1, ...$vars);
    }

    public function insert(string $sql, string $types = NULL, $var1 = NULL, ...$vars)
    {
        $this->action_query($sql, $types, $var1, ...$vars);
        return $this->conn->insert_id;
    }

    public function update(string $sql, string $types = NULL, $var1 = NULL, ...$vars): void
    {
        $this->action_query($sql, $types, $var1, ...$vars);
    }

    public function delete(string $sql, string $types = NULL, $var1 = NULL, ...$vars): void
    {
        $this->action_query($sql, $types, $var1, ...$vars);
    }

    public function query_from_file(string $filename)
    {
        $file = fopen($filename, 'r');
        $sql = fread($file, filesize($filename));
        if (!$this->conn->multi_query($sql)) {
            throw new InternalServerError(ERR_DB_RESET, $this->conn->errno . ': ' . $this->conn->error);
        }
        fclose($file);
    }

    public function begin_transaction()
    {
        if (!$this->conn->begin_transaction()) {
            throw new InternalServerError(ERR_DB_BEGIN_TRANSACTION);
        }
    }

    public function commit()
    {
        if (!$this->conn->commit()) {
            throw new InternalServerError(ERR_DB_COMMIT);
        }
    }

    public static function keys(array $data): string
    {
        $keys = array_reduce(array_keys($data), function ($previous, $current) {
            return $previous . "`$current`=?, ";
        });
        return substr($keys, 0, -2);
    }

    public static function types(array $data): string
    {
        return array_reduce($data, function ($previous, $current) {
            switch (gettype($current)) {
                case 'integer':
                    return $previous . 'i';
                case 'string':
                    return $previous . 's';
            }
        });
    }

    public function escape(string $string): string
    {
        return $this->conn->real_escape_string($string);
    }
}
