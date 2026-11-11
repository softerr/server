<?php
declare(strict_types=1);

function quizGrantOwnerId(array $user, int $quizId, bool $edit = false): ?int
{
    return tokenOwnerAccess($user, 'quiz', $quizId, $edit);
}

function readableQuizGrantIds(array $user): array
{
    return tokenOwnerResourceIds($user, 'quiz');
}

