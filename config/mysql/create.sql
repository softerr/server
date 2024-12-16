START TRANSACTION;

DROP TRIGGER IF EXISTS `user`.`before_insert_login_token`;

DROP TABLE IF EXISTS `user`.`login_token`;
DROP TABLE IF EXISTS `user`.`user_role`;
DROP TABLE IF EXISTS `user`.`role`;
DROP TABLE IF EXISTS `user`.`user`;
DROP DATABASE IF EXISTS `user`;

CREATE DATABASE `user`;

CREATE TABLE `user`.`user` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `email` varchar(255) NOT NULL,
    `username` varchar(255) NULL DEFAULT NULL,
    `password` varchar(255) NOT NULL,
    `activated` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`)
);

CREATE TABLE `user`.`role` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `name` varchar(255) NOT NULL,
    `label` varchar(255) NOT NULL,
    PRIMARY KEY(`id`)
);

CREATE TABLE `user`.`user_role` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `role_id` int(11) NOT NULL,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `user`.`user`(`id`) ON DELETE CASCADE,
    FOREIGN KEY(`role_id`) REFERENCES `user`.`role`(`id`) ON DELETE CASCADE
);

CREATE TABLE `user`.`login_token` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `token` varchar(32) NULL,
    `created` timestamp NULL,
    `expires` timestamp NULL,
    `expired` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `user`.`user`(`id`) ON DELETE CASCADE
);

DELIMITER //

CREATE TRIGGER `user`.`before_insert_login_token`
BEFORE INSERT ON `user`.`login_token`
FOR EACH ROW
thisTrigger:BEGIN
    IF (@TRIGGER_CHECKS = FALSE) AND ((USER() = 'root@localhost') OR (USER() = 'admin@localhost')) THEN
        LEAVE thisTrigger;
    END IF;
	SET NEW.token = REPLACE(UUID(), '-', ''),
		NEW.created = utc_timestamp(),
		NEW.expires = (utc_timestamp() + INTERVAL 4 HOUR);
END;

//

DELIMITER ;

INSERT INTO `user`.`role` (`name`, `label`) VALUES
    ('USER', 'User'),
    ('MOD', 'Moderator'),
    ('ADMIN', 'Administrator');

INSERT INTO `user`.`user` (`email`, `username`, `password`, `activated`) VALUES
    ('${ADMIN_EMAIL}', '${ADMIN_USER}', '${ADMIN_PASS}', 1);

INSERT INTO `user`.`user_role` (`user_id`, `role_id`) VALUES
    (1, 1),
    (1, 2),
    (1, 3);

COMMIT;
