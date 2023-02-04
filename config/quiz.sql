START TRANSACTION;

DROP TABLE IF EXISTS `image`

DROP TABLE IF EXISTS `game_answer`;
DROP TABLE IF EXISTS `game_question`;
DROP TABLE IF EXISTS `game_quiz`;
DROP TABLE IF EXISTS `answer`;
DROP TABLE IF EXISTS `question`;
DROP TABLE IF EXISTS `type`;
DROP TABLE IF EXISTS `quiz`;
DROP TABLE IF EXISTS `password_token`;
DROP TABLE IF EXISTS `login_token`;
DROP TABLE IF EXISTS `activate_token`;
DROP TABLE IF EXISTS `user_role`;
DROP TABLE IF EXISTS `user`;
DROP TABLE IF EXISTS `role`;

CREATE TABLE `role` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `name` varchar(255) NOT NULL,
    `label` varchar(255) NOT NULL,
    PRIMARY KEY(`id`)
);

CREATE TABLE `user` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `email` varchar(255) NOT NULL,
    `username` varchar(255) NULL DEFAULT NULL,
    `password` varchar(255) NOT NULL,
    `activated` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`)
);

CREATE TABLE `user_role` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `role_id` int(11) NOT NULL,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
    FOREIGN KEY(`role_id`) REFERENCES `role`(`id`) ON DELETE CASCADE
);

CREATE TABLE `activate_token` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `token` varchar(32) NOT NULL DEFAULT replace(uuid(), '-', ''),
    `created` timestamp NOT NULL DEFAULT utc_timestamp(),
    `expires` timestamp NOT NULL DEFAULT (utc_timestamp() + interval 4 hour),
    `expired` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `login_token` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `token` varchar(32) NOT NULL DEFAULT replace(uuid(), '-', ''),
    `created` timestamp NOT NULL DEFAULT utc_timestamp(),
    `expires` timestamp NOT NULL DEFAULT (utc_timestamp() + interval 4 hour),
    `expired` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `password_token` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `token` varchar(32) NOT NULL DEFAULT replace(uuid(), '-', ''),
    `created` timestamp NOT NULL DEFAULT utc_timestamp(),
    `expires` timestamp NOT NULL DEFAULT (utc_timestamp() + interval 4 hour),
    `used` tinyint(1) NOT NULL DEFAULT 0,
    `expired` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `quiz` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `name` varchar(255) NOT NULL,
    `description` text DEFAULT NULL,
    `public` tinyint(1) NOT NULL DEFAULT 0,
    `status` tinyint(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE TABLE `type` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `name` varchar(255) NOT NULL,
    `label` varchar(255) NOT NULL,
    PRIMARY KEY(`id`)
);

CREATE TABLE `question` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `quiz_id` int(11) NOT NULL,
    `type_id` int(11) NOT NULL,
    `question` text NOT NULL,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`quiz_id`) REFERENCES `quiz`(`id`) ON DELETE CASCADE,
    FOREIGN KEY(`type_id`) REFERENCES `type`(`id`) ON DELETE CASCADE
);

CREATE TABLE `answer` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `question_id` int(11) NOT NULL,
    `answer` text NULL DEFAULT NULL,
    `correct` tinyint(1) NULL DEFAULT NULL,
    PRIMARY KEY(`id`),
    FOREIGN KEY(`question_id`) REFERENCES `question`(`id`) ON DELETE CASCADE
);

CREATE TABLE `game_quiz` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `user_id` int(11) NOT NULL,
    `quiz_id` int(11) NOT NULL,
    `start` timestamp NOT NULL DEFAULT utc_timestamp(),
    `end` timestamp NULL DEFAULT NULL,
    `current_question` int(11) NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`quiz_id`) REFERENCES `quiz`(`id`) ON DELETE CASCADE
);

CREATE TABLE `game_question` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `game_quiz_id` int(11) NOT NULL,
    `question_id` int(11) NOT NULL,
    `type_id` int(11) NOT NULL,
    `question` text NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`game_quiz_id`) REFERENCES `game_quiz`(`id`) ON DELETE CASCADE,
    FOREIGN KEY(`type_id`) REFERENCES `type`(`id`) ON DELETE CASCADE
);

CREATE TABLE `game_answer` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `game_question_id` int(11) NOT NULL,
    `answer` text NULL DEFAULT NULL,
    `correct` tinyint(1) NULL DEFAULT NULL,
    `user_answer` text NULL DEFAULT NULL,
    `user_correct` tinyint(1) NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`game_question_id`) REFERENCES `game_question`(`id`) ON DELETE CASCADE
);

CREATE TABLE `image` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `path` varchar(255) NULL DEFAULT NULL,
    PRIMARY KEY (`id`)
);

INSERT INTO `role` (`name`, `label`) VALUES
    ('USER', 'User'),
    ('MOD', 'Moderator'),
    ('ADMIN', 'Administrator');

INSERT INTO `user` (`email`, `username`, `password`, `activated`) VALUES
    ('admin@quizzmaker.com', 'admin', '$2y$10$a2L0ggAMgFPEEwvEGeLdfuASLuPkWV/W08AljAU5yOCnZ5Zyr.yOa', 1),
    ('mod@quizzmaker.com', 'mod', '$2y$10$KhkzQxsfO1g6nRos6EjCdu0E0hFDMViPdngLipV18VKM2Up4cmx6y', 1),
    ('user@quizzmaker.com', 'user', '$2y$10$Wpx/VUZodS5Z7v8O2eYBk./Ihp1fkuGPYRzbYx1klohgYh4hKEArO', 1),
    ('test@quizzmaker.com', NULL, '$2y$10$Wpx/VUZodS5Z7v8O2eYBk./Ihp1fkuGPYRzbYx1klohgYh4hKEArO', 1);

INSERT INTO `user_role` (`user_id`, `role_id`) VALUES
    (1, 1),
    (1, 2),
    (1, 3),
    (2, 1),
    (2, 2),
    (3, 1);

INSERT INTO `type` (`name`, `label`) VALUES
    ('MULTIPLE_ANSWER', 'Multiple answer'),
    ('MULTIPLE_CHOICE', 'Multiple choice'),
    ('TRUE_FALSE', 'True/False'),
    ('YES_NO', 'Yes/No'),
    ('NUMBER', 'Number'),
    ('OPEN', 'Open'),
    ('SHORT', 'Short answer'),
    ('SHOW_ANSWER', 'Show answer'),
    ('NO_ANSWER', 'No answer');

COMMIT;