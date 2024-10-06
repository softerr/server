-- Remove anonymous users;
DELETE FROM mysql.user WHERE USER='';

-- Remove remote root;
DELETE FROM mysql.user WHERE USER='root' AND HOST NOT IN ('localhost', '127.0.0.1', '::1');

-- Remove test database;
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';

-- Reload privilege tables;
FLUSH PRIVILEGES;
