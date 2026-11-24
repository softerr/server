import { buildQuestion } from './question-view.js'
import { decorateReviewedQuestion } from './review.js'
import { renderScoreSummary } from './score-summary.js'

function element(tag, className = '', text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function quizIdFromHash() {
  const id = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('quiz')
  return id && /^[1-9][0-9]*$/.test(id) ? id : null
}

function attemptIdFromHash() {
  const id = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('attempt')
  return id && /^[1-9][0-9]*$/.test(id) ? id : null
}

function fromExplore() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('source') === 'explore'
}

function attemptDate(value) {
  return value ? `${String(value).replace(' ', ' · ')} UTC` : ''
}

function spentTime(milliseconds) {
  const seconds = Math.round(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export function renderQuizAttempts(app, { requestJson, responseError, setStatus }) {
  const quizId = quizIdFromHash()
  const explore = fromExplore()
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="quiz-attempts-page">
      <a class="back-button" href="#${explore ? 'explore' : 'library'}">← ${explore ? 'Explore' : 'Library'}</a>
      <div class="attempt-heading">
        <h1 class="section-title">Attempts</h1>
        <a id="attempts-play" class="auth-button auth-button-primary" href="#library">Play quiz</a>
      </div>
      <p id="attempts-quiz-name" class="attempt-quiz-name"></p>
      <p id="attempts-status" class="form-status" role="status" aria-live="polite">Loading attempts…</p>
      <ul id="attempts-list" class="attempts-list"></ul>
      <button id="attempts-more" class="auth-button auth-button-secondary" type="button" hidden>Load more</button>
    </main>
  `
  const status = page.querySelector('#attempts-status')
  const list = page.querySelector('#attempts-list')
  const more = page.querySelector('#attempts-more')
  if (!quizId) { setStatus(status, 'Quiz not found.', true); return }
  page.querySelector('#attempts-play').href = `#play?quiz=${quizId}${explore ? '&source=explore' : ''}`
  let nextBefore = null

  function addAttempts(attempts) {
    for (const attempt of attempts) {
      const item = element('li', 'attempt-item')
      const link = element('a', 'attempt-review-link')
      link.href = `#attempt?quiz=${quizId}&attempt=${attempt.id}${explore ? '&source=explore' : ''}`
      link.append(element('strong', '', attempt.completed ? 'Completed attempt' : 'In progress'),
        element('span', '', attemptDate(attempt.created)),
        element('span', '', `${attempt.answered_count} of ${attempt.question_count} questions answered`))
      item.append(link)
      if (!attempt.completed) {
        const resume = element('a', 'auth-button auth-button-secondary', 'Continue')
        resume.href = `#play?quiz=${quizId}${explore ? '&source=explore' : ''}`
        item.append(resume)
      }
      list.append(item)
    }
  }

  async function loadMore(before = null) {
    more.disabled = true
    try {
      const path = `/api/quiz/quizzes/${quizId}/attempts${before ? `?before=${before}` : ''}`
      const [response, payload] = await requestJson('GET', path)
      if (!app.contains(list)) return
      if (!response.ok) { setStatus(status, responseError(response, payload), true); return }
      addAttempts(payload.attempts || [])
      nextBefore = payload.next_before
      more.hidden = nextBefore === null
      setStatus(status, list.children.length ? '' : 'No attempts yet. Play this quiz to start one.')
    } catch {
      if (app.contains(list)) setStatus(status, 'Could not load attempts. Please try again.', true)
    } finally {
      more.disabled = false
    }
  }

  more.addEventListener('click', () => { if (nextBefore !== null) void loadMore(nextBefore) })
  requestJson('GET', `/api/quiz/quizzes/${quizId}`).then(([response, quiz]) => {
    if (!app.contains(list)) return
    if (!response.ok) { setStatus(status, responseError(response, quiz), true); return }
    page.querySelector('#attempts-quiz-name').textContent = quiz.name
    void loadMore()
  }).catch(() => {
    if (app.contains(list)) setStatus(status, 'Could not load this quiz. Please try again.', true)
  })
}

export function renderQuizAttempt(app, { requestJson, responseError, setStatus }) {
  const quizId = quizIdFromHash()
  const attemptId = attemptIdFromHash()
  const explore = fromExplore()
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="quiz-play-page quiz-review-page">
      <a id="review-back" class="back-button" href="#library">← Attempts</a>
      <h1 id="review-title" class="section-title">Attempt review</h1>
      <p id="review-date" class="attempt-quiz-name"></p>
      <p id="review-status" class="form-status" role="status" aria-live="polite">Loading attempt…</p>
      <section id="review-summary" class="play-results" hidden></section>
      <div id="review-questions" class="review-questions"></div>
    </main>
  `
  const status = page.querySelector('#review-status')
  const questionsArea = page.querySelector('#review-questions')
  if (!quizId || !attemptId) {
    setStatus(status, 'Attempt not found.', true)
    return
  }
  page.querySelector('#review-back').href = `#attempts?quiz=${quizId}${explore ? '&source=explore' : ''}`
  Promise.all([
    requestJson('GET', `/api/quiz/quizzes/${quizId}`),
    requestJson('GET', `/api/quiz/quizzes/${quizId}/attempts/${attemptId}`),
  ]).then(([[quizResponse, quiz], [attemptResponse, attempt]]) => {
    if (!app.contains(questionsArea)) return
    if (!quizResponse.ok) { setStatus(status, responseError(quizResponse, quiz), true); return }
    if (!attemptResponse.ok) { setStatus(status, responseError(attemptResponse, attempt), true); return }
    page.querySelector('#review-title').textContent = quiz.name
    page.querySelector('#review-date').textContent = `${attempt.completed ? 'Completed' : 'In progress'} · Started ${attemptDate(attempt.created)}`
    const summary = page.querySelector('#review-summary')
    const score = attempt.score
    let answered = 0
    const revealSolutions = Boolean(attempt.completed && quiz.show_correct_answers)
    for (const [index, question] of (attempt.questions || []).entries()) {
      const view = buildQuestion(question, index)
      view.card.hidden = false
      view.card.querySelector('.play-question-type').after(
        element('p', 'review-time-spent', `Time spent: ${spentTime(question.time_spent_ms || 0)}`))
      const hasSavedAnswer = Object.prototype.hasOwnProperty.call(attempt.answers ?? {}, question.id)
      let result = null
      if (hasSavedAnswer) {
        answered++
        if (question.template !== 'show_answer') view.restoreAnswer(attempt.answers[question.id])
        result = view.complete(false, revealSolutions ? question.correct : 'hidden')
      } else {
        view.lock()
        view.card.append(element('p', 'play-feedback', 'No saved answer'))
      }
      view.lock()
      if (revealSolutions) {
        decorateReviewedQuestion(view, question, attempt.answers?.[question.id], result, hasSavedAnswer)
      }
      questionsArea.append(view.card)
    }
    summary.hidden = false
    summary.append(element('h2', '', attempt.completed ? 'Completed attempt' : 'Unfinished attempt'),
      element('p', '', `${answered} of ${attempt.questions.length} questions answered.`))
    if (score?.graded) summary.append(element('p', '', `${score.correct} of ${score.graded} automatically graded answers correct.`))
    if (score?.match_total) summary.append(element('p', '', `Match choices: ${score.match_correct} of ${score.match_total} correct.`))
    if (score?.diagram_total) summary.append(element('p', '', `Diagram labels: ${score.diagram_correct} of ${score.diagram_total} correct.`))
    const action = element('a', 'auth-button auth-button-secondary', attempt.completed ? 'Play again' : 'Continue')
    action.href = `#play?quiz=${quizId}${explore ? '&source=explore' : ''}`
    summary.append(action)
    setStatus(status, '')
  }).catch(() => {
    if (app.contains(questionsArea)) setStatus(status, 'Could not load this attempt. Please try again.', true)
  })
}

export function renderQuizResults(app, { requestJson, responseError, setStatus }) {
  const quizId = quizIdFromHash()
  const attemptId = attemptIdFromHash()
  const explore = fromExplore()
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="quiz-play-page quiz-result-page">
      <a class="back-button" href="#${explore ? 'explore' : 'library'}">← ${explore ? 'Explore' : 'Library'}</a>
      <h1 id="result-title" class="section-title">Results</h1>
      <p id="result-status" class="form-status" role="status" aria-live="polite">Loading results…</p>
      <section id="result-summary" class="play-results" hidden></section>
    </main>
  `
  const status = page.querySelector('#result-status')
  const summary = page.querySelector('#result-summary')
  if (!quizId || !attemptId) { setStatus(status, 'Results not found.', true); return }
  Promise.all([
    requestJson('GET', `/api/quiz/quizzes/${quizId}`),
    requestJson('GET', `/api/quiz/quizzes/${quizId}/attempts/${attemptId}`),
  ]).then(([[quizResponse, quiz], [attemptResponse, attempt]]) => {
    if (!app.contains(summary)) return
    if (!quizResponse.ok) { setStatus(status, responseError(quizResponse, quiz), true); return }
    if (!attemptResponse.ok) { setStatus(status, responseError(attemptResponse, attempt), true); return }
    page.querySelector('#result-title').textContent = quiz.name
    page.querySelector('.quiz-result-page').classList.add(attempt.play_style === 'game_show' ? 'is-game-show' : 'is-basic')
    if (!attempt.completed) {
      summary.append(element('h2', '', 'Attempt in progress'),
        element('p', '', 'Finish the quiz to see your results.'))
      const continueLink = element('a', 'auth-button auth-button-primary', 'Continue quiz')
      continueLink.href = `#play?quiz=${quizId}${explore ? '&source=explore' : ''}`
      summary.append(continueLink)
    } else {
      const review = element('a', 'auth-button auth-button-secondary', 'Review answers')
      review.href = `#attempt?quiz=${quizId}&attempt=${attemptId}${explore ? '&source=explore' : ''}`
      const again = element('a', 'auth-button auth-button-secondary', 'Play again')
      again.href = `#play?quiz=${quizId}${explore ? '&source=explore' : ''}`
      renderScoreSummary(summary, { title: 'Results', score: attempt.score, actions: [review, again] })
    }
    summary.hidden = false
    setStatus(status, '')
  }).catch(() => {
    if (app.contains(summary)) setStatus(status, 'Could not load results. Please try again.', true)
  })
}
