import { createPreviewSource } from './preview-source.js'
import { createQuizRunner } from './quiz-runner.js'
import { decorateReviewedQuestion } from './review.js'
import { renderScoreSummary } from './score-summary.js'

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
  `
  const runner = createQuizRunner(dialog, {
    initialTitle: quiz.name,
    finishLabel: 'Finish preview',
    scrollToTop: () => { dialog.scrollTop = 0 },
  })
  runner.configure(quiz)
  const { page, progress, timerArea, summary, questionArea, controls } = runner
  questionArea.id = 'preview-review-questions'
  const unlimited = quiz.question_limit === 0
  const source = createPreviewSource(quiz, questions)
  const views = []
  const reviewQuestions = []
  const deadlines = []
  const quizDeadline = quiz.time_limit_seconds === null ? null : Date.now() + quiz.time_limit_seconds * 1000
  let tickTimer = null
  let completed = false
  function appendView() {
    const presented = source.nextQuestion()
    const view = runner.addQuestion(presented, views.length, {
      onChange: () => {
        if (views[position] === view) flow.updateControls()
      },
    })
    reviewQuestions.push({ ...presented,
      solution: { ...presented.config, ...(view.displayOrder ? { _display_order: view.displayOrder } : {}) } })
    view.timeLimit = presented.time_limit_seconds
    views.push(view)
    deadlines.push(null)
  }
  const initialCount = source.initialCount
  for (let i = 0; i < initialCount; i++) appendView()
  let position = 0
  const flow = runner.createFlow({
    currentQuestion: () => views[position],
    isUnlimited: () => unlimited,
    isLast: () => position === views.length - 1,
    onAdvance: advancePreview,
    onFinish: completePreview,
  })

  function showPosition() {
    if (views[position].timeLimit !== null && deadlines[position] === null) {
      deadlines[position] = Date.now() + views[position].timeLimit * 1000
    }
    runner.showPosition({ views, position, total: views.length, unlimited, allowGoBack: quiz.allow_go_back, flow })
    tick()
  }

  function tick() {
    if (completed || !dialog.open) { clearInterval(tickTimer); return }
    flow.tick({ quizDeadline, questionDeadline: deadlines[position],
      questionTimeLimit: views[position]?.timeLimit ?? null })
  }

  runner.bindControls(flow, () => {
    if (quiz.allow_go_back && position > 0) { position--; showPosition() }
  })
  function completePreview() {
    if (completed) return
    completed = true
    clearInterval(tickTimer)
    const results = views.map((view, index) => {
      const answer = view.getAnswer()
      const result = view.complete()
      decorateReviewedQuestion(view, reviewQuestions[index], answer, result)
      view.card.hidden = true
      return result
    })
    const graded = results.filter((result) => result !== null).length
    const correct = results.filter((result) => result === true).length
    const matchScores = views.flatMap((view) => view.matchScore ? [view.matchScore()] : [])
    const matchTotal = matchScores.reduce((sum, score) => sum + score.total, 0)
    const matchCorrect = matchScores.reduce((sum, score) => sum + score.correct, 0)
    const diagramScores = views.flatMap((view) => view.diagramScore ? [view.diagramScore()] : []).filter(Boolean)
    const diagramTotal = diagramScores.reduce((sum, score) => sum + score.total, 0)
    const diagramCorrect = diagramScores.reduce((sum, score) => sum + score.correct, 0)
    const reviewButton = element('button', 'auth-button auth-button-secondary', 'Review answers')
    reviewButton.type = 'button'
    reviewButton.setAttribute('aria-expanded', 'false')
    reviewButton.setAttribute('aria-controls', 'preview-review-questions')
    reviewButton.addEventListener('click', () => {
      const showing = reviewButton.getAttribute('aria-expanded') !== 'true'
      reviewButton.setAttribute('aria-expanded', String(showing))
      reviewButton.textContent = showing ? 'Hide answers' : 'Review answers'
      views.forEach((view) => { view.card.hidden = !showing })
      page.classList.toggle('quiz-review-page', showing)
      questionArea.classList.toggle('review-questions', showing)
      dialog.scrollTop = 0
    })
    renderScoreSummary(summary, { title: 'Preview complete',
      score: { graded, correct, ungraded: results.length - graded,
        match_total: matchTotal, match_correct: matchCorrect,
        diagram_total: diagramTotal, diagram_correct: diagramCorrect },
      notice: 'Answers were not saved.', actions: [reviewButton] })
    progress.hidden = true
    timerArea.hidden = true
    controls.hidden = true
    dialog.scrollTop = 0
  }
  function advancePreview() {
    if (position < views.length - 1) { position++; showPosition(); return }
    appendView()
    position++
    showPosition()
  }
  dialog.querySelector('.quiz-preview-close').addEventListener('click', () => { clearInterval(tickTimer); dialog.close() })
  dialog.showModal()
  runner.setReady()
  showPosition()
  tickTimer = setInterval(tick, 250)
}
