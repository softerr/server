START TRANSACTION;

INSERT INTO `quiz`.`role` (`name`, `label`) VALUES
    ('USER', 'User'),
    ('MOD', 'Moderator'),
    ('ADMIN', 'Administrator');

INSERT INTO `quiz`.`user` (`email`, `username`, `password`, `activated`) VALUES
    ('test@quizzmaker.com', 'test', '$2y$10$tP7Et6o5/Ne5ralvuxUSv.nSl50bZd8Vym4UToHWxn2XTa3BRy/c6', 1);

INSERT INTO `quiz`.`user_role` (`user_id`, `role_id`) VALUES
    (1, 1),
    (1, 2),
    (1, 3);

INSERT INTO `quiz`.`type` (`name`, `label`) VALUES
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
