import { createQuestionFlow } from './question-flow.js'
import { buildQuestion } from './question-view.js'

export function createQuizRunner(container, { backHref = null, backLabel = '', finishLabel = 'Finish quiz',
  initialTitle = 'Play quiz', initialStatus = '', scrollToTop = () => {} } = {}) {
  container.insertAdjacentHTML('beforeend', `
    <main class="quiz-play-page">
      ${backHref ? '<a class="back-button" data-runner-back></a>' : ''}
      <h1 id="play-title" class="section-title" data-runner-title></h1>
      <p id="play-description" class="play-description" data-runner-description hidden></p>
      <p id="play-status" class="form-status" role="status" aria-live="polite" data-runner-status></p>
      <div id="play-progress" class="play-progress" data-runner-progress hidden></div>
      <div id="play-timers" class="play-timers" data-runner-timers hidden>
        <span id="play-quiz-timer" data-runner-quiz-timer hidden></span><span id="play-question-timer" data-runner-question-timer hidden></span>
      </div>
      <section class="play-results" data-runner-summary hidden></section>
      <div id="play-questions" class="quiz-runner-questions" data-runner-questions></div>
      <div id="play-controls" class="play-controls" data-runner-controls hidden>
        <button id="play-previous" class="auth-button auth-button-secondary" type="button" data-runner-previous>Previous</button>
        <button id="play-finish" class="auth-button auth-button-secondary" type="button" data-runner-finish hidden></button>
        <button id="play-next" class="auth-button auth-button-primary" type="button" data-runner-next>Next</button>
      </div>
    </main>
  `)
  const page = container.querySelector('.quiz-play-page')
  const back = page.querySelector('[data-runner-back]')
  if (back) { back.href = backHref; back.textContent = `← ${backLabel}` }
  const title = page.querySelector('[data-runner-title]')
  const description = page.querySelector('[data-runner-description]')
  const status = page.querySelector('[data-runner-status]')
  const progress = page.querySelector('[data-runner-progress]')
  const timerArea = page.querySelector('[data-runner-timers]')
  const quizTimer = page.querySelector('[data-runner-quiz-timer]')
  const questionTimer = page.querySelector('[data-runner-question-timer]')
  const summary = page.querySelector('[data-runner-summary]')
  const questionArea = page.querySelector('[data-runner-questions]')
  const controls = page.querySelector('[data-runner-controls]')
  const previous = page.querySelector('[data-runner-previous]')
  const next = page.querySelector('[data-runner-next]')
  const finish = page.querySelector('[data-runner-finish]')
  title.textContent = initialTitle
  status.textContent = initialStatus
  status.hidden = !initialStatus
  finish.textContent = finishLabel

  function configure(quiz) {
    title.textContent = quiz.name
    description.textContent = quiz.description || ''
    description.hidden = !quiz.description
    page.classList.toggle('is-game-show', quiz.play_style === 'game_show')
    page.classList.toggle('is-basic', quiz.play_style !== 'game_show')
    const unlimited = quiz.question_limit === 0
    finish.hidden = !unlimited
    progress.classList.toggle('is-unlimited', unlimited)
  }

  function setReady() {
    progress.hidden = false
    controls.hidden = false
    status.textContent = ''
  }

  function addQuestion(question, index, { onInput, onChange } = {}) {
    const view = buildQuestion(question, index)
    if (onInput) view.card.addEventListener('input', onInput)
    if (onChange) view.card.addEventListener('change', onChange)
    questionArea.append(view.card)
    return view
  }

  function showPosition({ views, position, total, unlimited, allowGoBack, flow }) {
    views.forEach(({ card }, index) => { card.hidden = index !== position })
    progress.textContent = unlimited ? `Question ${position + 1} · Until you finish` : `Question ${position + 1} of ${total}`
    if (!unlimited) progress.style.setProperty('--progress', `${(position / total) * 100}%`)
    previous.hidden = !allowGoBack || position === 0
    next.textContent = !unlimited && position === total - 1 ? finishLabel : 'Next'
    flow.updateControls()
    scrollToTop(page)
  }

  function bindControls(flow, onPrevious) {
    previous.addEventListener('click', onPrevious)
    finish.addEventListener('click', () => { void flow.finish() })
    next.addEventListener('click', () => { void flow.next() })
  }

  function createFlow(config) {
    return createQuestionFlow({ ...config, nextButton: next, finishButton: finish,
      timerArea, quizTimer, questionTimer })
  }

  return { page, title, description, status, progress, timerArea, quizTimer, questionTimer, summary,
    questionArea, controls, previous, next, finish, configure, setReady, addQuestion,
    showPosition, bindControls, createFlow }
}
