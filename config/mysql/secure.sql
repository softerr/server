-- Remove anonymous users;
DELETE FROM mysql.user WHERE USER='';

-- Remove remote root;
DELETE FROM mysql.user WHERE USER='root' AND HOST NOT IN ('localhost', '127.0.0.1', '::1');

-- Remove test database;
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';

DROP USER IF EXISTS 'php'@'localhost';
CREATE USER 'php'@'localhost' IDENTIFIED BY 'php';
GRANT SELECT, UPDATE, INSERT, DELETE ON `user`.* TO 'php'@'localhost';

-- Reload privilege tables;
FLUSH PRIVILEGES;
