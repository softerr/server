import apiFetch from "../../hooks/apiFetch";

export function quizSignIn(email, password, onSuccess, onError) {
    return apiFetch("/api/users/signin", "POST", undefined, { email, password }, onSuccess, onError);
}

export function getModQuizzes(token, onSuccess, onError) {
    return apiFetch(`/api/quiz/modquizzes`, "GET", token, undefined, onSuccess, onError);
}

export function updateModQuiz(token, quizId, modQuiz, onSuccess, onError) {
    return apiFetch(`/api/quiz/modquizzes/${quizId}`, "PATCH", token, modQuiz, onSuccess, onError);
}

export function getModQuizQuestions(token, quizId, onSuccess, onError) {
    return apiFetch(`/api/quiz/modquizzes/${quizId}/questions`, "GET", token, undefined, onSuccess, onError);
}

export function getUserQuizzes(token, userId, onSuccess, onError) {
    return apiFetch(`/api/quiz/users/${userId}/quizzes`, "GET", token, undefined, onSuccess, onError);
}

export function deleteUserQuiz(token, userId, quizId, onSuccess, onError) {
    return apiFetch(`/api/quiz/users/${userId}/quizzes/${quizId}`, "DELETE", token, undefined, onSuccess, onError);
}

export function getTypes(token, onSuccess, onError) {
    return apiFetch(`/api/quiz/types`, "GET", token, undefined, onSuccess, onError);
}

export function createOrUpdateUserQuizQuestion(token, userId, quizId, questionId, question, onSuccess, onError) {
    return apiFetch(questionId ? `/api/quiz/users/${userId}/quizzes/${quizId}/questions/${questionId}` : `/api/quiz/users/${userId}/quizzes/${quizId}/questions`, questionId ? "PATCH" : "POST", token, question, onSuccess, onError);
}

export function getUserQuizQuestions(token, userId, quizId, onSuccess, onError) {
    return apiFetch(`/api/quiz/users/${userId}/quizzes/${quizId}/questions`, "GET", token, undefined, onSuccess, onError);
}

export function deleteUserQuizQuestion(token, userId, quizId, questionId, onSuccess, onError) {
    return apiFetch(`/api/quiz/users/${userId}/quizzes/${quizId}/questions/${questionId}`, "DELETE", token, undefined, onSuccess, onError);
}

export function createOrUpdateUserQuiz(token, userId, quizId, quiz, onSuccess, onError) {
    return apiFetch(quizId ? `/api/quiz/users/${userId}/quizzes/${quizId}` : `/api/quiz/users/${userId}/quizzes`, quizId ? "PATCH" : "POST", token, quiz, onSuccess, onError);
}

export function updateQuizGame(token, quizId, gameId, game, onSuccess, onError) {
    return apiFetch(`/api/quiz/quizzes/${quizId}/games/${gameId}`, "PATCH", token, game, onSuccess, onError);
}

export function createQuizGame(token, quizId, game, onSuccess, onError) {
    return apiFetch(`/api/quiz/quizzes/${quizId}/games`, "POST", token, game, onSuccess, onError);
}

export function getQuizzes(token, onSuccess, onError) {
    return apiFetch(`/api/quiz/quizzes`, "GET", token, undefined, onSuccess, onError);
}

export function getRoles(token, onSuccess, onError) {
    return apiFetch(`/api/quiz/roles`, "GET", token, undefined, onSuccess, onError);
}

export function getUserRoles(token, userId, onSuccess, onError) {
    return apiFetch(`/api/quiz/users/${userId}/roles`, "GET", token, undefined, onSuccess, onError);
}

export function updateUser(token, userId, user, onSuccess, onError) {
    return apiFetch(`/api/quiz/users/${userId}`, "PATCH", token, user, onSuccess, onError);
}

export function createOrUpdateUserRole(token, userId, roleId, role, onSuccess, onError) {
    return apiFetch(roleId === 0 ? `/api/quiz/users/${userId}/roles` : `/api/quiz/users/${userId}/roles/${roleId}`, roleId === 0 ? "POST" : "PATCH", token, role, onSuccess, onError);
}

export function deleteUserRole(token, userId, roleId, onSuccess, onError) {
    return apiFetch(`/api/quiz/users/${userId}/roles/${roleId}`, "DELETE", token, undefined, onSuccess, onError);
}

export function getUsers(token, onSuccess, onError) {
    return apiFetch(`/api/quiz/users`, "GET", token, undefined, onSuccess, onError);
}
