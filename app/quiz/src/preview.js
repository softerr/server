import { buildQuestion } from './play.js'

function element(tag, className = '', text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function openQuizPreview(dialog, quiz, questions) {
  dialog.innerHTML = `
    <div class="quiz-preview-toolbar">
      <span>Preview · Answers are not saved</span>
      <button class="icon-action quiz-preview-close" type="button" aria-label="Close preview" title="Close preview">×</button>
    </div>
    <main class="quiz-play-page">
      <h1 class="section-title"></h1>
      <p class="play-description" hidden></p>
      <div class="play-progress"></div>
      <div class="play-timers" data-preview-timers hidden><span data-preview-quiz-timer hidden></span><span data-preview-question-timer hidden></span></div>
      <div class="quiz-preview-questions"></div>
      <div class="play-controls">
        <button class="auth-button auth-button-secondary" type="button" data-preview-previous>Previous</button>
        <button class="auth-button auth-button-secondary" type="button" data-preview-finish hidden>Finish preview</button>
        <button class="auth-button auth-button-primary" type="button" data-preview-next>Next</button>
      </div>
    </main>
  `
  const page = dialog.querySelector('.quiz-play-page')
  page.querySelector('h1').textContent = quiz.name
  const description = page.querySelector('.play-description')
  description.textContent = quiz.description
  description.hidden = !quiz.description
  const gameShow = quiz.play_style === 'game_show'
  page.classList.add(gameShow ? 'is-game-show' : 'is-basic')
  const progress = page.querySelector('.play-progress')
  const timerArea = page.querySelector('[data-preview-timers]')
  const quizTimer = page.querySelector('[data-preview-quiz-timer]')
  const questionTimer = page.querySelector('[data-preview-question-timer]')
  const questionArea = page.querySelector('.quiz-preview-questions')
  const controls = page.querySelector('.play-controls')
  const previous = page.querySelector('[data-preview-previous]')
  const next = page.querySelector('[data-preview-next]')
  const finish = page.querySelector('[data-preview-finish]')
  const unlimited = quiz.question_limit === 0
  finish.hidden = !unlimited
  if (unlimited) progress.classList.add('is-unlimited')
  const pool = [...questions]
  if (quiz.question_limit === null && quiz.randomize_questions) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
  }
  const selectedIndexes = []
  function sourceAt(index) {
    let choice = index % pool.length
    if (quiz.randomize_questions && quiz.question_limit !== null) {
      const previous = selectedIndexes.at(-1)
      if (previous === undefined || pool.length === 1) {
        choice = Math.floor(Math.random() * pool.length)
      } else {
        choice = Math.floor(Math.random() * (pool.length - 1))
        if (choice >= previous) choice++
      }
    }
    selectedIndexes.push(choice)
    return pool[choice]
  }
  const views = []
  const deadlines = []
  const quizDeadline = quiz.time_limit_seconds === null ? null : Date.now() + quiz.time_limit_seconds * 1000
  const remaining = (deadline) => Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  const clockText = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  let tickTimer = null
  let completed = false
  const expiredQuestions = new Set()
  function appendView() {
    const source = sourceAt(views.length)
    const view = buildQuestion(source, views.length)
    view.timeLimit = source.time_limit_seconds
    views.push(view)
    deadlines.push(null)
    questionArea.append(view.card)
  }
  const initialCount = unlimited ? 1 : quiz.question_limit === null ? pool.length : quiz.question_limit
  for (let i = 0; i < initialCount; i++) appendView()
  let position = 0

  function showPosition() {
    if (views[position].timeLimit !== null && deadlines[position] === null) {
      deadlines[position] = Date.now() + views[position].timeLimit * 1000
    }
    views.forEach(({ card }, index) => { card.hidden = index !== position })
    progress.textContent = unlimited ? `Question ${position + 1} · Until you finish` : `Question ${position + 1} of ${views.length}`
    if (!unlimited) progress.style.setProperty('--progress', `${(position / views.length) * 100}%`)
    previous.hidden = !quiz.allow_go_back || position === 0
    next.textContent = !unlimited && position === views.length - 1 ? 'Finish preview' : 'Next'
    dialog.scrollTop = 0
    tick()
  }

  function tick() {
    if (completed || !dialog.open) { clearInterval(tickTimer); return }
    quizTimer.hidden = quizDeadline === null
    if (quizDeadline !== null) quizTimer.textContent = `Quiz ${clockText(remaining(quizDeadline))}`
    const deadline = deadlines[position]
    questionTimer.hidden = deadline === null
    if (deadline !== null) questionTimer.textContent = `Question ${clockText(remaining(deadline))}`
    timerArea.hidden = quizTimer.hidden && questionTimer.hidden
    if (quizDeadline !== null && remaining(quizDeadline) === 0) { completePreview(); return }
    if (deadline !== null && remaining(deadline) === 0 && !expiredQuestions.has(position)) {
      expiredQuestions.add(position)
      views[position].lock()
      if (!unlimited && position === views.length - 1) completePreview()
      else if (!unlimited) advancePreview()
    }
  }

  previous.addEventListener('click', () => {
    if (quiz.allow_go_back && position > 0) { position--; showPosition() }
  })
  function completePreview() {
    if (completed) return
    completed = true
    clearInterval(tickTimer)
    const results = views.map((view) => view.complete())
    const graded = results.filter((result) => result !== null).length
    const correct = results.filter((result) => result === true).length
    const summary = element('section', 'play-results')
    summary.append(element('h2', '', 'Preview complete'),
      element('p', '', graded
        ? `${correct} of ${graded} automatically graded questions correct.`
        : 'This quiz has no automatically graded questions.'),
      element('p', '', 'Answers were not saved.'))
    questionArea.replaceChildren(summary)
    progress.hidden = true
    timerArea.hidden = true
    controls.hidden = true
    dialog.scrollTop = 0
  }
  finish.addEventListener('click', completePreview)
  function advancePreview() {
    if (position < views.length - 1) { position++; showPosition(); return }
    if (!unlimited) { completePreview(); return }
    appendView()
    position++
    showPosition()
  }
  next.addEventListener('click', advancePreview)
  dialog.querySelector('.quiz-preview-close').addEventListener('click', () => { clearInterval(tickTimer); dialog.close() })
  dialog.showModal()
  showPosition()
  tickTimer = setInterval(tick, 250)
}
