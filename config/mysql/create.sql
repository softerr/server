START TRANSACTION;

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

INSERT INTO `user`.`role` (`name`, `label`) VALUES
    ('USER', 'User'),
    ('ADMIN', 'Administrator');

INSERT INTO `user`.`user` (`email`, `username`, `password`, `activated`) VALUES
    ('${ADMIN_EMAIL}', '${ADMIN_USER}', '${ADMIN_PASS}', 1);

INSERT INTO `user`.`user_role` (`user_id`, `role_id`) VALUES
    (1, 1),
    (1, 2);

COMMIT;
