START TRANSACTION;

DROP TABLE IF EXISTS `quiz`.`game_answer`;
DROP TABLE IF EXISTS `quiz`.`game_question`;
DROP TABLE IF EXISTS `quiz`.`game_quiz`;
DROP TABLE IF EXISTS `quiz`.`answer`;
DROP TABLE IF EXISTS `quiz`.`question`;
DROP TABLE IF EXISTS `quiz`.`type`;
DROP TABLE IF EXISTS `quiz`.`quiz`;
DROP TABLE IF EXISTS `quiz`.`password_token`;
DROP TABLE IF EXISTS `quiz`.`login_token`;
DROP TABLE IF EXISTS `quiz`.`activate_token`;
DROP TABLE IF EXISTS `quiz`.`user_role`;
DROP TABLE IF EXISTS `quiz`.`user`;
DROP TABLE IF EXISTS `quiz`.`role`;

DROP DATABASE IF EXISTS `quiz`;

CREATE DATABASE `quiz`;

CREATE TABLE `quiz`.`role` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `name` varchar(255) NOT NULL,
    `label` varchar(255) NOT NULL,
    PRIMARY KEY(`id`)
);

CREATE TABLE `quiz`.`user` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `email` varchar(255) NOT NULL,
    `username` varchar(255) NULL DEFAULT NULL,
    `password` varchar(255) NOT NULL,
    `activated` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`)
);

CREATE TABLE `quiz`.`user_role` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `role_id` int(11) NOT NULL,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `quiz`.`user`(`id`) ON DELETE CASCADE,
    FOREIGN KEY(`role_id`) REFERENCES `quiz`.`role`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`activate_token` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `token` varchar(32) NOT NULL DEFAULT replace(uuid(), '-', ''),
    `created` timestamp NOT NULL DEFAULT utc_timestamp(),
    `expires` timestamp NOT NULL DEFAULT (utc_timestamp() + interval 4 hour),
    `expired` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `quiz`.`user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`login_token` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `token` varchar(32) NOT NULL DEFAULT replace(uuid(), '-', ''),
    `created` timestamp NOT NULL DEFAULT utc_timestamp(),
    `expires` timestamp NOT NULL DEFAULT (utc_timestamp() + interval 4 hour),
    `expired` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `quiz`.`user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`password_token` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `token` varchar(32) NOT NULL DEFAULT replace(uuid(), '-', ''),
    `created` timestamp NOT NULL DEFAULT utc_timestamp(),
    `expires` timestamp NOT NULL DEFAULT (utc_timestamp() + interval 4 hour),
    `used` tinyint(1) NOT NULL DEFAULT 0,
    `expired` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `quiz`.`user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`quiz` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `name` varchar(255) NOT NULL,
    `description` text DEFAULT NULL,
    `public` tinyint(1) NOT NULL DEFAULT 0,
    `status` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `quiz`.`user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`type` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `name` varchar(255) NOT NULL,
    `label` varchar(255) NOT NULL,
    PRIMARY KEY(`id`)
);

CREATE TABLE `quiz`.`question` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `quiz_id` int(11) NOT NULL,
    `type_id` int(11) NOT NULL,
    `question` text NOT NULL,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`quiz_id`) REFERENCES `quiz`.`quiz`(`id`) ON DELETE CASCADE,
    FOREIGN KEY(`type_id`) REFERENCES `quiz`.`type`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`answer` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `question_id` int(11) NOT NULL,
    `answer` text NULL DEFAULT NULL,
    `correct` tinyint(1) NULL DEFAULT NULL,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`question_id`) REFERENCES `quiz`.`question`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`game_quiz` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `quiz_id` int(11) NOT NULL,
    `start` timestamp NOT NULL DEFAULT utc_timestamp(),
    `end` timestamp NULL DEFAULT NULL,
    `current_question` int(11) NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`user_id`) REFERENCES `quiz`.`user`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`quiz_id`) REFERENCES `quiz`.`quiz`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`game_question` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `game_quiz_id` int(11) NOT NULL,
    `question_id` int(11) NOT NULL,
    `type_id` int(11) NOT NULL,
    `question` text NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`game_quiz_id`) REFERENCES `quiz`.`game_quiz`(`id`) ON DELETE CASCADE,
    FOREIGN KEY(`type_id`) REFERENCES `quiz`.`type`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz`.`game_answer` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `game_question_id` int(11) NOT NULL,
    `answer` text NULL DEFAULT NULL,
    `correct` tinyint(1) NULL DEFAULT NULL,
    `user_answer` text NULL DEFAULT NULL,
    `user_correct` tinyint(1) NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`game_question_id`) REFERENCES `quiz`.`game_question`(`id`) ON DELETE CASCADE
);

COMMIT;
