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
  function appendView() {
    const view = buildQuestion(sourceAt(views.length), views.length)
    views.push(view)
    questionArea.append(view.card)
  }
  const initialCount = unlimited ? 1 : quiz.question_limit === null ? pool.length : quiz.question_limit
  for (let i = 0; i < initialCount; i++) appendView()
  let position = 0

  function showPosition() {
    views.forEach(({ card }, index) => { card.hidden = index !== position })
    progress.textContent = unlimited ? `Question ${position + 1} · Until you finish` : `Question ${position + 1} of ${views.length}`
    if (!unlimited) progress.style.setProperty('--progress', `${(position / views.length) * 100}%`)
    previous.hidden = position === 0
    next.textContent = !unlimited && position === views.length - 1 ? 'Finish preview' : 'Next'
    dialog.scrollTop = 0
  }

  previous.addEventListener('click', () => {
    if (position > 0) { position--; showPosition() }
  })
  function completePreview() {
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
    controls.hidden = true
    dialog.scrollTop = 0
  }
  finish.addEventListener('click', completePreview)
  next.addEventListener('click', () => {
    if (position < views.length - 1) { position++; showPosition(); return }
    if (!unlimited) { completePreview(); return }
    appendView()
    position++
    showPosition()
  })
  dialog.querySelector('.quiz-preview-close').addEventListener('click', () => dialog.close())
  dialog.showModal()
  showPosition()
}
