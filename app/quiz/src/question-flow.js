export function createQuestionFlow({ currentQuestion, isUnlimited, isLast, nextButton, finishButton,
  timerArea, quizTimer, questionTimer, onAdvance, onFinish, onExpire = () => {} }) {
  const expiredQuestions = new WeakSet()
  const remaining = (deadline, now) => Math.max(0, Math.ceil((deadline - now) / 1000))
  const clockText = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  const isExpired = () => {
    const question = currentQuestion()
    return question !== undefined && question !== null && expiredQuestions.has(question)
  }

  const canContinue = () => {
    const question = currentQuestion()
    return !question || expiredQuestions.has(question) || question.canContinue()
  }

  function updateControls() {
    const ready = canContinue()
    nextButton.disabled = !ready
    finishButton.disabled = !ready
  }

  function finish(force = false) {
    if (!force && !canContinue()) return
    return onFinish(force || isExpired())
  }

  function next() {
    if (!canContinue()) return
    if (!isUnlimited() && isLast()) return finish()
    return onAdvance(isExpired())
  }

  function expire() {
    const question = currentQuestion()
    if (!question || expiredQuestions.has(question)) return
    expiredQuestions.add(question)
    question.lock()
    updateControls()
    onExpire()
    if (!isUnlimited()) void next()
  }

  function tick({ quizDeadline, questionDeadline, questionTimeLimit, now = Date.now(), canExpire = true }) {
    quizTimer.hidden = quizDeadline === null
    if (quizDeadline !== null) quizTimer.textContent = `Quiz ${clockText(remaining(quizDeadline, now))}`
    questionTimer.hidden = questionTimeLimit === null
    if (questionDeadline !== null) {
      questionTimer.textContent = `Question ${clockText(remaining(questionDeadline, now))}`
    } else if (!questionTimer.hidden) questionTimer.textContent = 'Question timer starting…'
    timerArea.hidden = quizTimer.hidden && questionTimer.hidden
    if (quizDeadline !== null && remaining(quizDeadline, now) === 0) { void finish(true); return }
    if (questionDeadline !== null && remaining(questionDeadline, now) === 0 && canExpire) expire()
  }

  return { updateControls, finish, next, tick }
}
