<?php
require_once('Api/Utils/Database.php');
require_once('Api/Repo/GameQuizRepo.php');
require_once('Api/Repo/QuestionRepo.php');
require_once('Api/Repo/AnswerRepo.php');
require_once('Api/Repo/GameQuestionRepo.php');
require_once('Api/Repo/GameAnswerRepo.php');
require_once('Api/Entity/GameQuestion.php');

class GameQuizManager
{
    public static function insert(Database $db, int $userId, int $quizId, object &$gameQuiz)
    {
        $gameQuizRepo = new GameQuizRepo($db);
        $gameQuizRepo->insert($userId, $quizId, $gameQuiz);
        $gameQuestionRepo = new GameQuestionRepo($db);
        $gameAnswerRepo = new GameAnswerRepo($db);

        $gameQuestionRepo->insertQuestions($gameQuiz->id);
        $gameAnswerRepo->insertAnswers($gameQuiz->id);

        $questions = $gameQuestionRepo->getByGameQuizId($gameQuiz->id);
        if (count($questions) > 0) {
            $gameQuiz->question = $questions[0];
            $gameQuiz->question['answers'] = $gameAnswerRepo->getByGameQuestionId($gameQuiz->question['id'],  $questions[0]['type_id']);
        }
        $gameQuiz->question_count = count($questions);
    }

    public static function update(Database $db, int $id, int $userId, int $quizId, object &$gameQuiz)
    {
        $gameQuestionRepo = new GameQuestionRepo($db);
        $questions = $gameQuestionRepo->getByGameQuizId($id);
        if ((!isset($gameQuiz->end) || !$gameQuiz->end) && isset($gameQuiz->current_question)) {
            if ($gameQuiz->current_question >= count($questions)) {
                throw new NotFound(ERR_NOT_FOUND);
            }
        }
        $gameQuizRepo = new GameQuizRepo($db);
        if (isset($gameQuiz->answers)) {
            $currentQuestion = $gameQuizRepo->get($id, $userId, $quizId)->current_question;
            GameAnswerManager::updateAll($db, $questions[$currentQuestion]['id'], $gameQuiz->answers,  $questions[$currentQuestion]['type_id']);
        }
        $gameQuizRepo->update($id, $userId, $quizId, $gameQuiz);
        $gameAnswerRepo = new GameAnswerRepo($db);
        if (!isset($gameQuiz->end) && isset($gameQuiz->current_question)) {
            $gameQuiz->question = $questions[$gameQuiz->current_question];
            $gameQuiz->question['answers'] = $gameAnswerRepo->getByGameQuestionId($gameQuiz->question['id'], $questions[$gameQuiz->current_question]['type_id']);
        }
        $gameQuiz->question_count = count($questions);

        if (isset($gameQuiz->end)) {
            $gameQuiz->questions = $gameQuestionRepo->getByGameQuizId($gameQuiz->id);
            foreach ($gameQuiz->questions as &$question) {
                $question['answers'] = $gameAnswerRepo->getByGameQuestionIdResult($question['id']);
            }
        }
    }
}
