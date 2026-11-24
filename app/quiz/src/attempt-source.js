export function createAttemptSource(quizId, requestJson) {
  const quizPath = `/api/quiz/quizzes/${quizId}`
  let attemptPath = null

  return {
    loadQuiz: () => requestJson('GET', quizPath),
    startAttempt: () => requestJson('POST', `${quizPath}/attempts`),
    useAttempt(id) { attemptPath = `${quizPath}/attempts/${id}` },
    startQuestion: (id) => requestJson('POST', `${attemptPath}/questions/${id}/start`),
    saveAnswer: (id, answer) => requestJson('PUT', `${attemptPath}/answers/${id}`, { answer }),
    nextQuestion: (after) => requestJson('POST', `${attemptPath}/next`, { after }),
    revealAnswer: (id) => requestJson('POST', `${attemptPath}/questions/${id}/reveal`),
    complete: () => requestJson('POST', `${attemptPath}/complete`),
    async saveQuestionTime(id, milliseconds) {
      const response = await fetch(`${attemptPath}/questions/${id}/time`, {
        method: 'PUT', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time_spent_ms: milliseconds }),
      })
      if (!response.ok) throw new Error('Could not save question time.')
    },
  }
}
