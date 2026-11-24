import { submitAttempt } from './submit-attempt.js'
import { createQuizRunner } from './quiz-runner.js'
import { createAttemptSource } from './attempt-source.js'

export function renderQuizPlay(app, { requestJson, responseError, setStatus }) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const quizId = params.get('quiz')
  const source = createAttemptSource(quizId, requestJson)
  const fromExplore = params.get('source') === 'explore'
  const host = app.querySelector('#page')
  host.replaceChildren()
  const runner = createQuizRunner(host, {
    backHref: `#${fromExplore ? 'explore' : 'library'}`,
    backLabel: fromExplore ? 'Explore' : 'Library',
    initialStatus: 'Loading quiz…',
    scrollToTop: (page) => page.scrollIntoView({ block: 'start' }),
  })
  const { status, questionArea, previous, next, finish } = runner
  let unlimited = false
  let questionCount = 0
  let allowGoBack = true
  let questions = []
  let position = 0
  let finished = false
  let attemptId = null
  let navigating = false
  const dirtyQuestions = new Set()
  let saveTimer = null
  let saveQueue = Promise.resolve()
  let quizDeadline = null
  let serverOffset = 0
  let tickTimer = null
  const startingQuestions = new Map()
  const timeSpent = new Map()
  const sentTime = new Map()
  let activeQuestionId = null
  let sampledAt = performance.now()
  let countingTime = false
  let timeTimer = null
  const canCountTime = () => document.visibilityState === 'visible' && document.hasFocus()
  function sampleTime() {
    const now = performance.now()
    if (countingTime && activeQuestionId !== null) {
      timeSpent.set(activeQuestionId, Math.min(2147483647,
        (timeSpent.get(activeQuestionId) || 0) + Math.max(0, now - sampledAt)))
    }
    sampledAt = now
  }
  async function saveQuestionTime(questionId) {
    if (questionId === null || attemptId === null) return
    const milliseconds = Math.floor(timeSpent.get(questionId) || 0)
    if (milliseconds <= (sentTime.get(questionId) || 0)) return
    await source.saveQuestionTime(questionId, milliseconds)
    sentTime.set(questionId, Math.max(sentTime.get(questionId) || 0, milliseconds))
  }
  function pauseTime() {
    sampleTime()
    countingTime = false
    void saveQuestionTime(activeQuestionId).catch(() => {})
  }
  function resumeTime() {
    sampledAt = performance.now()
    countingTime = activeQuestionId !== null && canCountTime()
  }
  function leavePlay() {
    if (finished) return
    pauseTime()
    clearInterval(timeTimer)
    clearInterval(tickTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', resumeTime)
    window.removeEventListener('blur', pauseTime)
    window.removeEventListener('pagehide', pauseTime)
    window.removeEventListener('hashchange', onHashChange)
  }
  function onVisibilityChange() { if (document.visibilityState === 'hidden') pauseTime(); else resumeTime() }
  function onHashChange() { if (!app.contains(questionArea)) leavePlay() }
  const flow = runner.createFlow({
    currentQuestion: () => questions[position],
    isUnlimited: () => unlimited,
    isLast: () => position === questionCount - 1,
    onAdvance: advanceQuestion,
    onFinish: completeAttempt,
    onExpire: () => {
      dirtyQuestions.delete(position)
      if (unlimited) setStatus(status, 'Question time is up. Select Next to continue.')
    },
  })
  function syncAttemptClock(attempt) {
    quizDeadline = attempt.deadline_ms
    if (typeof attempt.server_time_ms === 'number') serverOffset = attempt.server_time_ms - Date.now()
  }
  function goToResults() {
    leavePlay()
    finished = true
    clearInterval(tickTimer)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#results?quiz=${quizId}&attempt=${attemptId}${fromExplore ? '&source=explore' : ''}`)
    window.dispatchEvent(new Event('hashchange'))
  }
  async function startCurrentQuestion() {
    const question = questions[position]
    if (!question || finished) return false
    if (question.started || (allowGoBack && question.timeLimit === null)) return true
    if (startingQuestions.has(question.id)) return startingQuestions.get(question.id)
    const request = (async () => {
      try {
        const [response, payload] = await source.startQuestion(question.id)
        if (!app.contains(questionArea)) return false
        if (!response.ok) {
          if (response.status === 409 && payload?.error === 'Attempt is complete') { goToResults(); return false }
          throw new Error(responseError(response, payload))
        }
        syncAttemptClock(payload)
        const started = payload.questions.find((item) => item.id === question.id)
        question.deadline = started?.deadline_ms ?? null
        question.started = Boolean(started?.started)
        tick()
        return true
      } catch (error) {
        setStatus(status, error.message || 'Could not start question.', true)
        return false
      } finally {
        startingQuestions.delete(question.id)
      }
    })()
    startingQuestions.set(question.id, request)
    return request
  }
  function tick() {
    if (finished || !app.contains(questionArea) || attemptId === null) { clearInterval(tickTimer); return }
    const question = questions[position]
    const questionDeadline = question?.deadline ?? null
    flow.tick({ quizDeadline, questionDeadline, questionTimeLimit: question?.timeLimit ?? null,
      now: Date.now() + serverOffset, canExpire: !navigating })
  }

  function markDirty(index) {
    if (finished || attemptId === null) return
    dirtyQuestions.add(index)
    setStatus(status, '')
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void flushAnswers().catch(() => {}) }, 400)
  }

  function flushAnswers() {
    clearTimeout(saveTimer)
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      if (!await startCurrentQuestion()) throw new Error('Could not start question.')
      while (dirtyQuestions.size) {
        const index = dirtyQuestions.values().next().value
        dirtyQuestions.delete(index)
        const question = questions[index]
        try {
          const [response, payload] = await source.saveAnswer(question.id, question.getAnswer())
          if (response.status === 409) {
            question.lock()
            if (payload?.error === 'Attempt is complete') { goToResults(); return }
            continue
          }
          if (!response.ok) throw new Error(responseError(response, payload))
        } catch (error) {
          dirtyQuestions.add(index)
          setStatus(status, error.message || 'Could not save answer. Please try again.', true)
          throw error
        }
      }
    })
    return saveQueue
  }

  function showPosition() {
    sampleTime()
    const previousQuestionId = activeQuestionId
    activeQuestionId = questions[position]?.id ?? null
    if (previousQuestionId !== activeQuestionId) void saveQuestionTime(previousQuestionId).catch(() => {})
    resumeTime()
    runner.showPosition({ views: questions, position, total: questionCount, unlimited, allowGoBack, flow })
    void startCurrentQuestion()
    tick()
  }

  runner.bindControls(flow, async () => {
    if (!allowGoBack || position <= 0 || navigating) return
    navigating = true
    previous.disabled = true
    markDirty(position)
    try { await flushAnswers(); position--; showPosition() } catch { /* status is shown by flushAnswers */ }
    finally { previous.disabled = false; navigating = false }
  })
  async function completeAttempt(expired = false) {
    if (navigating || attemptId === null) return
    navigating = true
    next.disabled = true
    finish.disabled = true
    if (!expired) markDirty(position)
    else dirtyQuestions.clear()
    try {
      const [response, payload] = await submitAttempt({
        saveAnswers: expired ? null : flushAnswers,
        saveTime: () => { sampleTime(); return saveQuestionTime(activeQuestionId) },
        complete: source.complete,
      })
      if (!response.ok) throw new Error(responseError(response, payload))
      goToResults()
    } catch (error) {
      setStatus(status, error.message || 'Could not finish quiz. Please try again.', true)
    } finally {
      flow.updateControls()
      navigating = false
    }
  }
  async function advanceQuestion(expired = false) {
    if (navigating || attemptId === null) return
    navigating = true
    next.disabled = true
    if (!expired) markDirty(position)
    try {
      if (!expired) await flushAnswers()
      if (position === questions.length - 1) {
        const [response, payload] = await source.nextQuestion(questions[position].id)
        if (!response.ok) throw new Error(responseError(response, payload))
        const newQuestion = payload.questions?.[questions.length]
        if (!newQuestion) throw new Error('Could not load next question.')
        appendQuestion(newQuestion, questions.length, payload.answers)
        questionCount = payload.question_count
      }
      position++
      showPosition()
    } catch (error) {
      setStatus(status, error.message || 'Could not load next question. Please try again.', true)
    } finally {
      flow.updateControls()
      navigating = false
    }
  }

  function appendQuestion(question, index, answers) {
    if (question.template === 'show_answer' && !question.config?.answer) {
      question.reveal = async () => {
        if (!await startCurrentQuestion()) throw new Error('Could not start question.')
        const [response, payload] = await source.revealAnswer(question.id)
        if (!response.ok) { setStatus(status, responseError(response, payload), true); throw new Error('Could not reveal answer.') }
        return payload
      }
    }
    const view = { id: question.id, timeLimit: question.time_limit_seconds, started: question.started,
      deadline: question.deadline_ms, ...runner.addQuestion(question, index, {
        onInput: () => markDirty(index),
        onChange: () => {
          markDirty(index)
          if (index === position) flow.updateControls()
        },
      }) }
    questions.push(view)
    timeSpent.set(question.id, question.time_spent_ms || 0)
    sentTime.set(question.id, question.time_spent_ms || 0)
    if (answers?.[question.id]) view.restoreAnswer(answers[question.id])
  }

  if (!quizId || !/^[1-9][0-9]*$/.test(quizId)) {
    setStatus(status, 'Quiz not found.', true)
    return
  }
  source.loadQuiz().then(async ([quizResponse, quiz]) => {
    if (!app.contains(questionArea)) return
    if (!quizResponse.ok) { setStatus(status, responseError(quizResponse, quiz), true); return }
    runner.configure(quiz)
    const [attemptResponse, attempt] = await source.startAttempt()
    if (!app.contains(questionArea)) return
    if (!attemptResponse.ok) { setStatus(status, responseError(attemptResponse, attempt), true); return }
    attemptId = attempt.id
    source.useAttempt(attemptId)
    if (attempt.completed !== null) { goToResults(); return }
    syncAttemptClock(attempt)
    allowGoBack = attempt.allow_go_back
    runner.configure({ ...quiz, play_style: attempt.play_style, question_limit: attempt.question_limit })
    if (!Array.isArray(attempt.questions) || !attempt.questions.length) {
      setStatus(status, 'This quiz has no questions yet.')
      return
    }
    unlimited = attempt.question_limit === 0
    questionCount = attempt.question_count
    attempt.questions.forEach((question, index) => appendQuestion(question, index, attempt.answers))
    const firstUnanswered = questions.findIndex((question) =>
      !Object.prototype.hasOwnProperty.call(attempt.answers ?? {}, question.id) || !question.canContinue())
    if (!allowGoBack) position = Math.max(0, Math.min(questions.length - 1, attempt.furthest_position - 1))
    else if (firstUnanswered > 0) position = firstUnanswered
    else if (firstUnanswered === -1) position = questions.length - 1
    runner.setReady()
    showPosition()
    tickTimer = setInterval(tick, 250)
    timeTimer = setInterval(() => {
      if (!app.contains(questionArea)) { leavePlay(); return }
      sampleTime()
      void saveQuestionTime(activeQuestionId).catch(() => {})
    }, 5000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', resumeTime)
    window.addEventListener('blur', pauseTime)
    window.addEventListener('pagehide', pauseTime)
    window.addEventListener('hashchange', onHashChange)
  }).catch(() => {
    if (app.contains(questionArea)) setStatus(status, 'Could not load this quiz. Please try again.', true)
  })
}

