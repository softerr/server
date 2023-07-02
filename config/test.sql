START TRANSACTION;

INSERT INTO `user`.`user` (`email`, `username`, `password`, `activated`) VALUES
    ('test@quizzmaker.com', 'test', '$2y$10$tP7Et6o5/Ne5ralvuxUSv.nSl50bZd8Vym4UToHWxn2XTa3BRy/c6', 1);

INSERT INTO `user`.`user_role` (`user_id`, `role_id`) VALUES
    (1, 1),
    (1, 2);

INSERT INTO `quiz`.`user_role` (`user_id`, `role_id`) VALUES
    (1, 1),
    (1, 2),
    (1, 3);

COMMIT;
