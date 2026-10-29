import { buildQuestion } from './play.js'

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

function answerContent(text, imageId) {
  const content = element('span', 'review-answer-content')
  if (text) content.append(element('span', '', text))
  if (imageId) {
    const image = element('img', 'review-answer-image')
    image.src = `/api/media/images/${imageId}`
    image.alt = text || 'Answer image'
    content.append(image)
  }
  return content
}

function correctAnswers(question) {
  const config = question.solution || {}
  const rows = []
  const row = (...parts) => {
    const item = element('li', 'review-answer-item')
    parts.forEach((part) => item.append(part))
    rows.push(item)
  }
  switch (question.template) {
    case 'number':
    case 'short_answer':
    case 'show_answer':
      row(answerContent(config.answer, config.answer_image_id))
      break
    case 'open':
      if (config.sample_answer || config.answer_image_id) row(answerContent(config.sample_answer, config.answer_image_id))
      break
    case 'ordering':
      for (const [index, item] of (config.items || []).entries()) {
        row(element('strong', '', `${index + 1}.`), answerContent(item.text, item.image_id))
      }
      break
    default:
      break
  }
  if (!rows.length) return null
  const section = element('section', 'review-correct-answers')
  section.append(element('h3', '', question.template === 'open' ? 'Sample answer' : 'Correct answer'))
  const list = element('ul', 'review-answer-list')
  list.append(...rows)
  section.append(list)
  return section
}

function markReviewedChoices(card, question) {
  const choices = card.querySelectorAll('.play-choice-list .play-choice')
  const options = question.solution?.options || []
  const optionOrder = question.solution?._option_order || options.map((_, index) => index)
  const booleanChoice = question.template === 'true_false' || question.template === 'yes_no'
  choices.forEach((choice, index) => {
    const input = choice.querySelector('input')
    const selected = input?.checked === true
    const correct = booleanChoice
      ? input?.value === String(question.solution?.answer)
      : options[optionOrder[index]]?.correct === true
    choice.classList.add(selected === correct ? 'is-review-correct' : 'is-review-incorrect')
    const status = selected
      ? (correct ? 'Correctly selected' : 'Incorrectly selected')
      : (correct ? 'Missed correct choice' : 'Correctly left unselected')
    choice.append(element('span', 'review-choice-status', status))
  })
}

function correctAnswerButton(text, imageId) {
  const button = element('button', 'play-drag-card review-correct-card')
  button.type = 'button'
  button.disabled = true
  button.setAttribute('aria-description', 'Correct answer')
  button.append(answerContent(text, imageId))
  return button
}

function markReviewedMatch(card, question, savedAnswer) {
  const rows = card.querySelectorAll('.play-drag-activity.is-match .play-drop-row')
  const pairs = question.solution?.pairs || []
  const displayOrder = question.solution?._display_order || pairs.map((_, index) => index)
  const keywordOrder = question.solution?._keyword_order || pairs.map((_, index) => index)
  keywordOrder.forEach((sourceIndex, index) => {
    const pair = pairs[sourceIndex]
    const row = rows[index]
    if (!row) return
    const correct = String(savedAnswer?.assignments?.[index]) === String(displayOrder.indexOf(sourceIndex))
    const dragged = row.querySelector('.play-drop-zone .play-drag-card')
    if (dragged) dragged.classList.add(correct ? 'is-review-correct' : 'is-review-incorrect')
    row.append(element('span', 'review-choice-status', correct ? 'Correct match' : 'Incorrect match'))
    if (!correct) {
      const correction = element('div', 'review-match-correction')
      correction.append(correctAnswerButton(pair.definition, pair.definition_image_id))
      row.querySelector('.play-drop-zone').append(correction)
    }
  })
}

function markReviewedCategories(card, question, savedAnswer) {
  const categories = question.solution?.categories || []
  const categoryOrder = question.solution?._category_order || categories.map((_, index) => index)
  const sourceItems = categories.flatMap((category, categoryIndex) =>
    (category.items || []).map((answer) => ({ answer, categoryIndex: categoryOrder.indexOf(categoryIndex) })))
  const expectedItems = (question.solution?._display_order || sourceItems.map((_, index) => index))
    .map((source) => sourceItems[source])
  const items = card.querySelectorAll('.play-drag-activity .play-drag-card[data-source]')
  items.forEach((item) => {
    const source = Number(item.dataset.source)
    const categoryIndex = expectedItems[source]?.categoryIndex
    if (categoryIndex === undefined) return
    const correct = String(savedAnswer?.assignments?.[source]) === String(categoryIndex)
    item.classList.add(correct ? 'is-review-correct' : 'is-review-incorrect')
    item.setAttribute('aria-description', correct ? 'Correct placement' : 'Incorrect placement')
  })
  const zones = card.querySelectorAll('.play-drop-list .play-drop-zone')
  zones.forEach((zone, categoryIndex) => {
    const wrongItems = [...zone.querySelectorAll('.play-drag-card[data-source]')].filter((item) =>
      expectedItems[Number(item.dataset.source)]?.categoryIndex !== categoryIndex)
    const missingItems = expectedItems.flatMap(({ answer, categoryIndex: expected }, source) =>
      expected === categoryIndex && String(savedAnswer?.assignments?.[source]) !== String(categoryIndex)
        ? [answer] : [])
    missingItems.forEach((answer, index) => {
      const button = correctAnswerButton(answer.text, answer.image_id)
      if (wrongItems[index]) wrongItems[index].after(button)
      else zone.append(button)
    })
  })
}

function markReviewedBlanks(card, question) {
  const answers = question.solution?.answers || []
  card.querySelectorAll('.play-fill-line [data-answer-index]').forEach((input) => {
    const answerIndex = Number(input.dataset.answerIndex)
    const expected = answers[answerIndex]
    if (!expected) return
    const imagePosition = question.solution?._image_answer_indices?.indexOf(answerIndex) ?? -1
    const correct = expected.text
      ? input.value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
        === expected.text.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
      : input.value === String(question.solution?._display_order?.indexOf(imagePosition) ?? answerIndex)
    input.classList.add(correct ? 'is-review-correct' : 'is-review-incorrect')
    input.setAttribute('aria-description', correct ? 'Correct answer' : 'Incorrect answer')
    if (!correct) {
      const correction = element('span', 'review-blank-correction')
      const answer = element('span', 'review-blank-answer')
      answer.append(answerContent(expected.text, expected.image_id))
      correction.append(element('span', 'review-blank-arrow', '→'), answer)
      input.after(correction)
    }
  })
}

function markReviewedOrdering(card, question, savedAnswer) {
  const items = question.solution?.items || []
  const displayOrder = question.solution?._display_order || items.map((_, index) => index)
  const order = savedAnswer?.order
  if (!Array.isArray(order) || order.length !== items.length
    || new Set(order).size !== items.length
    || !order.every((value) => Number.isInteger(value) && value >= 0 && value < items.length)) return false
  card.querySelectorAll('.play-order-list .play-order-entry').forEach((entry, position) => {
    const row = entry.querySelector('.play-order-row')
    const correct = displayOrder[order[position]] === position
    row.classList.add(correct ? 'is-review-correct' : 'is-review-incorrect')
    row.setAttribute('aria-description', correct ? 'Correct position' : 'Incorrect position')
    entry.classList.add('review-order-entry')
    if (!correct) {
      const correction = element('div', 'review-order-correction')
      correction.append(answerContent(items[position].text, items[position].image_id))
      entry.append(correction)
    }
  })
  return true
}

function markReviewedTextAnswer(card, question, correct) {
  const input = card.querySelector('.play-text-field input')
  const answerArea = card.querySelector('.play-answer')
  if (!input || !answerArea) return
  input.classList.add(correct ? 'is-review-correct' : 'is-review-incorrect')
  input.setAttribute('aria-description', correct ? 'Correct answer' : 'Incorrect answer')
  if (correct) return
  answerArea.classList.add('review-text-answer-grid')
  const correction = element('div', 'review-text-correction')
  correction.append(element('span', 'review-text-correction-label', 'Correct answer'))
  const value = element('div', 'review-text-answer')
  value.append(answerContent(question.solution?.answer, question.solution?.answer_image_id))
  correction.append(value)
  answerArea.append(correction)
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
        if (['multiple_choice', 'one_choice', 'true_false', 'yes_no'].includes(question.template)) {
          markReviewedChoices(view.card, question)
        } else if (question.template === 'match') {
          markReviewedMatch(view.card, question, attempt.answers?.[question.id])
        } else if (question.template === 'categorize') {
          markReviewedCategories(view.card, question, attempt.answers?.[question.id])
        } else if (question.template === 'fill_blanks') {
          markReviewedBlanks(view.card, question)
        } else if (question.template === 'ordering' && hasSavedAnswer
          && markReviewedOrdering(view.card, question, attempt.answers[question.id])) {
          // The saved order is shown in place, with corrections beside wrong positions.
        } else if (['number', 'short_answer'].includes(question.template) && hasSavedAnswer) {
          markReviewedTextAnswer(view.card, question, result)
        } else {
          const solution = correctAnswers(question)
          if (solution) view.card.append(solution)
        }
      }
      questionsArea.append(view.card)
    }
    summary.hidden = false
    summary.append(element('h2', '', attempt.completed ? 'Completed attempt' : 'Unfinished attempt'),
      element('p', '', `${answered} of ${attempt.questions.length} questions answered.`))
    if (score?.graded) summary.append(element('p', '', `${score.correct} of ${score.graded} automatically graded answers correct.`))
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
      const { graded, correct, ungraded } = attempt.score || { graded: 0, correct: 0, ungraded: 0 }
      summary.append(element('h2', '', 'Results'),
        element('p', '', graded
          ? `${correct} of ${graded} automatically graded questions correct.`
          : 'This quiz has no automatically graded questions.'))
      if (ungraded) {
        summary.append(element('p', '', `${ungraded} study or open-answer questions were not graded.`))
      }
      const review = element('a', 'auth-button auth-button-secondary', 'Review answers')
      review.href = `#attempt?quiz=${quizId}&attempt=${attemptId}${explore ? '&source=explore' : ''}`
      const again = element('a', 'auth-button auth-button-secondary', 'Play again')
      again.href = `#play?quiz=${quizId}${explore ? '&source=explore' : ''}`
      summary.append(review, again)
    }
    summary.hidden = false
    setStatus(status, '')
  }).catch(() => {
    if (app.contains(summary)) setStatus(status, 'Could not load results. Please try again.', true)
  })
}
