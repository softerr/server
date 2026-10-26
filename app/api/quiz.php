<?php
declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/url.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/handlers/quizzes.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = apiRequestPath('/api/quiz');

if ($path === '/quizzes') {
    if ($method === 'GET') {
        handleListQuizzes();
    }
    if ($method === 'POST') {
        handleCreateQuiz();
    }
    respond(405, ['error' => 'Method not allowed']);
}

if (is_string($path) && preg_match('#^/quizzes/([1-9][0-9]*)$#', $path, $quizMatch)) {
    $quizId = filter_var($quizMatch[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($quizId === false) {
        respond(404, ['error' => 'Not found']);
    }
    if ($method === 'PATCH') {
        handleUpdateQuiz($quizId);
    }
    if ($method === 'DELETE') {
        handleDeleteQuiz($quizId);
    }
    respond(405, ['error' => 'Method not allowed']);
}

respond(404, ['error' => 'Not found']);
