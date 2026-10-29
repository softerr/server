import { moveDownIcon, moveUpIcon } from './icons.js'

const templateNames = {
  multiple_choice: 'Multiple choice', one_choice: 'One choice', number: 'Number',
  short_answer: 'Short answer', open: 'Open answer', true_false: 'True/false',
  yes_no: 'Yes/no', show_answer: 'Show answer', no_answer: 'No answer',
  match: 'Match', ordering: 'Ordering', fill_blanks: 'Fill in the blanks',
  categorize: 'Categorize',
}

const imageUrl = (id) => `/api/media/images/${id}`

function element(tag, className = '', text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function rich(text, imageId) {
  const content = element('span', 'play-rich')
  if (imageId) {
    const image = element('img', 'play-image')
    image.src = imageUrl(imageId)
    image.alt = text ? '' : 'Image'
    image.loading = 'lazy'
    content.append(image)
  }
  if (text) content.append(element('span', '', text))
  return content
}

function shuffledIndexes(length) {
  const indexes = Array.from({ length }, (_, index) => index)
  for (let index = indexes.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[indexes[index], indexes[other]] = [indexes[other], indexes[index]]
  }
  if (length > 1 && indexes.every((value, index) => value === index)) {
    ;[indexes[0], indexes[1]] = [indexes[1], indexes[0]]
  }
  return indexes
}

function normalized(text) {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function answerRow(text, imageId) {
  const row = element('div', 'play-answer-row')
  row.append(rich(text, imageId))
  return row
}

function dragAssignment(answer, items, targets, capacity) {
  const area = element('div', 'play-drag-activity')
  if (capacity === 1) area.classList.add('is-match')
  const instruction = element('p', 'play-instruction', 'Drag an answer into a space, or select an answer and then a space.')
  const bank = element('div', 'play-drag-bank')
  bank.setAttribute('aria-label', 'Answer bank')
  const zones = element('div', 'play-drop-list')
  const cards = items.map((item, itemIndex) => {
    const card = element('button', 'play-drag-card')
    card.type = 'button'
    card.draggable = true
    card.classList.add(`play-tone-${itemIndex % 4}`)
    card.dataset.item = String(itemIndex)
    card.dataset.source = String(item.source)
    card.append(rich(item.text, item.imageId))
    bank.append(card)
    return card
  })
  let selected = null
  let locked = false
  function choose(card) {
    if (locked) return
    selected?.classList.remove('is-selected')
    selected = selected === card ? null : card
    selected?.classList.add('is-selected')
  }
  function place(card, target) {
    if (locked || !card) return
    if (capacity === 1) {
      const existing = target.querySelector('.play-drag-card')
      if (existing && existing !== card) bank.append(existing)
    }
    target.append(card)
    selected?.classList.remove('is-selected')
    selected = null
    area.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function makeDrop(target) {
    target.addEventListener('dragover', (event) => { if (!locked) event.preventDefault() })
    target.addEventListener('drop', (event) => {
      event.preventDefault()
      const item = event.dataTransfer.getData('text/plain')
      if (/^(0|[1-9][0-9]*)$/.test(item)) place(cards[Number(item)], target)
    })
    target.addEventListener('click', (event) => {
      if (event.target.closest('.play-drag-card')) return
      place(selected, target)
    })
    target.addEventListener('keydown', (event) => {
      if (event.target === target && (event.key === 'Enter' || event.key === ' ') && selected) {
        event.preventDefault()
        place(selected, target)
      }
    })
  }
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      if (card.parentElement !== bank && selected !== card) {
        bank.append(card); choose(null)
        area.dispatchEvent(new Event('change', { bubbles: true }))
      }
      else choose(card)
    })
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', card.dataset.item)
      event.dataTransfer.effectAllowed = 'move'
    })
  })
  targets.forEach((target, targetIndex) => {
    const row = element('div', 'play-drop-row')
    row.append(rich(target.text, target.imageId))
    const slot = element('div', 'play-drop-zone')
    slot.dataset.target = String(targetIndex)
    slot.tabIndex = 0
    slot.setAttribute('role', 'button')
    slot.setAttribute('aria-label', `Place answer for ${target.text || `item ${targetIndex + 1}`}`)
    slot.append(element('span', 'play-drop-hint', capacity === 1 ? 'Drop definition here' : 'Drop items here'))
    makeDrop(slot)
    row.append(slot)
    zones.append(row)
  })
  makeDrop(bank)
  area.append(instruction, bank, zones)
  answer.append(area)
  return {
    grade: () => cards.every((card, index) => card.parentElement?.dataset.target === String(items[index].target)),
    finish: () => { locked = true; cards.forEach((card) => { card.draggable = false; card.disabled = true }) },
    getAnswer: () => {
      const assignments = Array(items.length).fill(null)
      cards.forEach((card, index) => { assignments[items[index].source] = card.parentElement?.dataset.target ?? null })
      return { assignments }
    },
    restoreAnswer: (saved) => {
      if (!Array.isArray(saved?.assignments)) return
      const bySource = new Map(cards.map((card, index) => [items[index].source, card]))
      cards.forEach((card) => bank.append(card))
      saved.assignments.forEach((target, source) => {
        const zone = zones.querySelector(`[data-target="${target}"]`)
        const card = bySource.get(source)
        if (zone && card && (capacity !== 1 || !zone.querySelector('.play-drag-card'))) zone.append(card)
      })
    },
  }
}

export function buildQuestion(question, index) {
  const config = question.config || {}
  const card = element('section', 'play-question')
  card.hidden = true
  card.append(element('p', 'play-question-type', `Question ${index + 1} · ${templateNames[question.template] || question.template}`))
  const prompt = element('div', 'play-prompt')
  card.append(prompt)
  if (question.template !== 'fill_blanks') prompt.append(element('h2', '', question.prompt))
  if (config.image_id) prompt.append(rich('', config.image_id))
  const answer = element('div', 'play-answer')
  card.append(answer)
  let grade = () => null
  let finish = () => {}
  let getAnswer = () => ({ viewed: true })
  let restoreAnswer = () => {}

  if (question.template === 'multiple_choice' || question.template === 'one_choice') {
    const options = config.options || []
    const multiple = question.template === 'multiple_choice'
    answer.append(element('p', 'play-instruction', multiple ? 'Choose all correct answers.' : 'Choose one answer.'))
    const choices = element('div', 'play-choice-list')
    const controls = options.map((option, optionIndex) => {
      const label = element('label', 'play-choice')
      const input = document.createElement('input')
      input.type = multiple ? 'checkbox' : 'radio'
      input.name = `play-choice-${index}`
      input.value = String(optionIndex)
      label.append(input, rich(option.text, option.image_id))
      choices.append(label)
      return input
    })
    answer.append(choices)
    grade = () => controls.every((input, optionIndex) => input.checked === options[optionIndex].correct)
      && controls.some((input) => input.checked)
    getAnswer = () => ({ selected: controls.flatMap((input, optionIndex) => input.checked ? [optionIndex] : []) })
    restoreAnswer = (saved) => {
      controls.forEach((input, i) => { input.checked = Array.isArray(saved?.selected) && saved.selected.includes(i) })
    }
  } else if (question.template === 'true_false' || question.template === 'yes_no') {
    const choices = element('div', 'play-choice-list play-choice-inline')
    const labels = question.template === 'true_false' ? ['True', 'False'] : ['Yes', 'No']
    for (const [choiceIndex, labelText] of labels.entries()) {
      const label = element('label', 'play-choice')
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = `play-boolean-${index}`
      input.value = String(choiceIndex === 0)
      label.append(input, element('span', '', labelText))
      choices.append(label)
    }
    answer.append(choices)
    grade = () => choices.querySelector('input:checked')?.value === String(config.answer)
    getAnswer = () => ({ selected: choices.querySelector('input:checked')?.value ?? null })
    restoreAnswer = (saved) => {
      choices.querySelectorAll('input').forEach((input) => { input.checked = input.value === saved?.selected })
    }
  } else if (question.template === 'number' || question.template === 'short_answer') {
    const label = element('label', 'field play-text-field')
    label.append(element('span', '', question.template === 'number' ? 'Your number' : 'Your answer'))
    const input = document.createElement('input')
    input.type = 'text'
    input.autocomplete = 'off'
    input.maxLength = question.template === 'number' ? 64 : 500
    if (question.template === 'number') input.inputMode = 'decimal'
    label.append(input)
    answer.append(label)
    grade = question.template === 'number'
      ? () => input.value.trim() !== '' && Number(input.value) === Number(config.answer)
      : () => input.value.trim() !== '' && normalized(input.value) === normalized(config.answer)
    getAnswer = () => ({ text: input.value })
    restoreAnswer = (saved) => { if (typeof saved?.text === 'string') input.value = saved.text }
  } else if (question.template === 'open') {
    const label = element('label', 'field play-text-field')
    label.append(element('span', '', 'Your answer'))
    const input = document.createElement('textarea')
    input.rows = 6
    input.maxLength = 1000
    label.append(input)
    answer.append(label)
    getAnswer = () => ({ text: input.value })
    restoreAnswer = (saved) => { if (typeof saved?.text === 'string') input.value = saved.text }
    if (config.sample_answer || config.answer_image_id) {
      const sample = element('div', 'play-reveal')
      sample.hidden = true
      sample.append(element('strong', '', 'Sample answer'))
      sample.append(answerRow(config.sample_answer, config.answer_image_id))
      answer.append(sample)
      finish = () => { sample.hidden = false }
    }
  } else if (question.template === 'show_answer') {
    const reveal = element('div', 'play-reveal')
    reveal.hidden = true
    reveal.append(answerRow(config.answer, config.answer_image_id))
    const button = element('button', 'auth-button auth-button-secondary', 'Show answer')
    button.type = 'button'
    button.addEventListener('click', async () => {
      if (question.reveal) {
        button.disabled = true
        try {
          const revealed = await question.reveal()
          reveal.replaceChildren(answerRow(revealed.answer, revealed.answer_image_id))
        } catch {
          button.disabled = false
          return
        }
      }
      reveal.hidden = false
      button.hidden = true
      card.dispatchEvent(new Event('change', { bubbles: true }))
    })
    answer.append(button, reveal)
    getAnswer = () => ({ revealed: !reveal.hidden })
    restoreAnswer = (saved) => {
      reveal.hidden = saved?.revealed !== true
      button.hidden = !reveal.hidden
    }
    finish = () => { reveal.hidden = false; button.hidden = true }
  } else if (question.template === 'no_answer') {
    answer.append(element('p', 'play-instruction', 'Read the question, then continue.'))
  } else if (question.template === 'match') {
    const pairs = config.pairs || []
    const definitions = config.definitions || pairs
    const activity = dragAssignment(answer,
      shuffledIndexes(pairs.length).map((pairIndex) => ({
        text: definitions[pairIndex].definition, imageId: definitions[pairIndex].definition_image_id,
        target: pairIndex, source: pairIndex,
      })),
      pairs.map((pair) => ({ text: pair.keyword, imageId: pair.keyword_image_id })), 1)
    grade = activity.grade
    finish = activity.finish
    getAnswer = () => {
      const assignments = Array(pairs.length).fill(null)
      activity.getAnswer().assignments.forEach((target, source) => {
        if (target !== null) assignments[Number(target)] = String(source)
      })
      return { assignments }
    }
    restoreAnswer = (saved) => {
      const byDefinition = Array(pairs.length).fill(null)
      if (Array.isArray(saved?.assignments)) {
        saved.assignments.forEach((source, target) => {
          if (source !== null && /^(0|[1-9][0-9]*)$/.test(String(source)) && Number(source) >= 0
            && Number(source) < pairs.length && byDefinition[Number(source)] === null) {
            byDefinition[Number(source)] = String(target)
          }
        })
      }
      activity.restoreAnswer({ assignments: byDefinition })
    }
  } else if (question.template === 'ordering') {
    const items = config.items || []
    const order = shuffledIndexes(items.length)
    const rows = element('div', 'play-order-list')
    let orderLocked = false
    function renderOrder() {
      rows.replaceChildren()
      order.forEach((itemIndex, position) => {
        const entry = element('div', 'play-order-entry')
        const number = element('span', 'play-order-number', String(position + 1))
        const row = element('div', 'play-order-row')
        row.classList.add(`play-tone-${itemIndex % 4}`)
        row.append(rich(items[itemIndex].text, items[itemIndex].image_id))
        row.classList.add('is-draggable')
        row.draggable = !orderLocked
        row.addEventListener('dragstart', (event) => {
          event.dataTransfer.setData('text/plain', String(position))
          event.dataTransfer.effectAllowed = 'move'
        })
        row.addEventListener('dragover', (event) => { if (!orderLocked) event.preventDefault() })
        row.addEventListener('drop', (event) => {
          event.preventDefault()
          if (orderLocked) return
          const value = event.dataTransfer.getData('text/plain')
          if (!/^(0|[1-9][0-9]*)$/.test(value)) return
          const from = Number(value)
          if (from >= order.length || from === position) return
          order.splice(position, 0, ...order.splice(from, 1))
          renderOrder()
          card.dispatchEvent(new Event('change', { bubbles: true }))
        })
        for (const [direction, labelText] of [[-1, 'Move up'], [1, 'Move down']]) {
          const button = element('button', 'icon-action')
          button.type = 'button'
          button.innerHTML = direction === -1 ? moveUpIcon : moveDownIcon
          button.setAttribute('aria-label', `${labelText} item ${position + 1}`)
          button.disabled = orderLocked || position + direction < 0 || position + direction >= order.length
          button.addEventListener('click', () => {
            ;[order[position], order[position + direction]] = [order[position + direction], order[position]]
            renderOrder()
            rows.children[position + direction]?.querySelectorAll('button')[direction === -1 ? 0 : 1]?.focus()
            card.dispatchEvent(new Event('change', { bubbles: true }))
          })
          row.append(button)
        }
        entry.append(number, row)
        rows.append(entry)
      })
    }
    renderOrder()
    answer.append(element('p', 'play-instruction', 'Drag items into order, or use the arrow buttons.'), rows)
    grade = () => order.every((value, position) => value === position)
    getAnswer = () => ({ order: [...order] })
    restoreAnswer = (saved) => {
      if (Array.isArray(saved?.order) && saved.order.length === order.length
        && new Set(saved.order).size === order.length
        && saved.order.every((value) => Number.isInteger(value) && value >= 0 && value < order.length)) {
        order.splice(0, order.length, ...saved.order)
        renderOrder()
      }
    }
    finish = () => { orderLocked = true; renderOrder() }
  } else if (question.template === 'fill_blanks') {
    const answers = config.answers || []
    const line = element('div', 'play-fill-line')
    const inputs = []
    const imageOnly = config.image_choices
      ? config.image_choices.map((item, choiceIndex) => ({ ...item, choiceIndex }))
      : answers.map((item, answerIndex) => ({ ...item, choiceIndex: answerIndex }))
        .filter((item) => !item.text && item.image_id)
    for (const part of question.prompt.split(/(\{\{[1-9][0-9]*\}\})/g)) {
      const match = /^\{\{([1-9][0-9]*)\}\}$/.exec(part)
      if (!match) { line.append(document.createTextNode(part)); continue }
      const answerIndex = Number(match[1]) - 1
      const expected = answers[answerIndex]
      if (!expected) continue
      if (expected.text) {
        const input = document.createElement('input')
        input.type = 'text'
        input.setAttribute('aria-label', `Blank ${answerIndex + 1}`)
        input.dataset.answerIndex = String(answerIndex)
        inputs[answerIndex] = input
        line.append(input)
      } else {
        const select = document.createElement('select')
        select.setAttribute('aria-label', `Image for blank ${answerIndex + 1}`)
        select.dataset.answerIndex = String(answerIndex)
        select.append(new Option('Choose image', ''))
        imageOnly.forEach((item, position) => select.append(new Option(`Image ${position + 1}`, String(item.choiceIndex))))
        inputs[answerIndex] = select
        line.append(select)
      }
    }
    prompt.append(line)
    answer.append(element('p', 'play-instruction', 'Fill each blank.'))
    if (imageOnly.length) {
      const bank = element('div', 'play-reference')
      bank.append(element('h3', '', 'Image choices'))
      imageOnly.forEach((item, position) => {
        const row = element('div', 'play-answer-row')
        row.prepend(element('strong', '', `${position + 1}.`))
        row.append(rich('', item.image_id))
        bank.append(row)
      })
      answer.append(bank)
    }
    grade = () => answers.every((expected, answerIndex) => {
      const input = inputs[answerIndex]
      if (!input) return false
      return expected.text ? normalized(input.value) === normalized(expected.text)
        : input.value === String(answerIndex)
    })
    getAnswer = () => ({ values: inputs.map((input) => input?.value ?? '') })
    restoreAnswer = (saved) => { inputs.forEach((input, i) => { if (input) input.value = saved?.values?.[i] ?? '' }) }
  } else if (question.template === 'categorize') {
    const categories = config.categories || []
    const items = config.items
      ? config.items.map((item) => ({ text: item.text, imageId: item.image_id }))
      : categories.flatMap((category, categoryIndex) =>
        (category.items || []).map((item) => ({ text: item.text, imageId: item.image_id, target: categoryIndex })))
    items.forEach((item, source) => { item.source = source })
    const activity = dragAssignment(answer, shuffledIndexes(items.length).map((i) => items[i]),
      categories.map((category) => ({ text: category.name, imageId: category.name_image_id })), Infinity)
    grade = activity.grade
    finish = activity.finish
    getAnswer = activity.getAnswer
    restoreAnswer = activity.restoreAnswer
  } else {
    answer.append(element('p', 'play-instruction', 'This question type is not available in play yet.'))
  }

  const feedback = element('p', 'play-feedback')
  feedback.hidden = true
  card.append(feedback)
  const solutionImage = config.answer_image_id && !['show_answer', 'open', 'no_answer'].includes(question.template)
    ? rich('', config.answer_image_id) : null
  if (solutionImage) { solutionImage.hidden = true; card.append(solutionImage) }
  return {
    card,
    getAnswer,
    restoreAnswer,
    lock() {
      card.inert = true
      card.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true })
      card.querySelectorAll('[draggable]').forEach((control) => { control.draggable = false })
    },
    complete(revealSolutions = true, serverCorrect = undefined) {
      const correct = serverCorrect === 'hidden' ? undefined : serverCorrect === undefined ? grade() : serverCorrect
      if (revealSolutions) finish()
      feedback.textContent = correct === undefined ? 'Answer saved' : correct === null ? 'Not automatically graded' : correct ? 'Correct' : 'Incorrect'
      feedback.classList.toggle('is-correct', correct === true)
      feedback.classList.toggle('is-incorrect', correct === false)
      feedback.hidden = false
      if (solutionImage && revealSolutions) solutionImage.hidden = false
      card.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true })
      return correct
    },
  }
}

export function renderQuizPlay(app, { requestJson, responseError, setStatus }) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const quizId = params.get('quiz')
  const fromExplore = params.get('source') === 'explore'
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="quiz-play-page">
      <a class="back-button" href="#${fromExplore ? 'explore' : 'library'}">← ${fromExplore ? 'Explore' : 'Library'}</a>
      <h1 id="play-title" class="section-title">Play quiz</h1>
      <p id="play-description" class="play-description" hidden></p>
      <p id="play-status" class="form-status" role="status" aria-live="polite">Loading quiz…</p>
      <div id="play-progress" class="play-progress" hidden></div>
      <div id="play-timers" class="play-timers" hidden>
        <span id="play-quiz-timer" hidden></span><span id="play-question-timer" hidden></span>
      </div>
      <div id="play-questions"></div>
      <div id="play-controls" class="play-controls" hidden>
        <button id="play-previous" class="auth-button auth-button-secondary" type="button">Previous</button>
        <button id="play-finish" class="auth-button auth-button-secondary" type="button" hidden>Finish quiz</button>
        <button id="play-next" class="auth-button auth-button-primary" type="button">Next</button>
      </div>
    </main>
  `
  const status = page.querySelector('#play-status')
  const title = page.querySelector('#play-title')
  const description = page.querySelector('#play-description')
  const progress = page.querySelector('#play-progress')
  const timerArea = page.querySelector('#play-timers')
  const quizTimer = page.querySelector('#play-quiz-timer')
  const questionTimer = page.querySelector('#play-question-timer')
  const questionArea = page.querySelector('#play-questions')
  const controls = page.querySelector('#play-controls')
  const previous = page.querySelector('#play-previous')
  const next = page.querySelector('#play-next')
  const finish = page.querySelector('#play-finish')
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
  const expiredQuestions = new Set()
  const remaining = (deadline) => Math.max(0, Math.ceil((deadline - (Date.now() + serverOffset)) / 1000))
  const clockText = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  function syncAttemptClock(attempt) {
    quizDeadline = attempt.deadline_ms
    if (typeof attempt.server_time_ms === 'number') serverOffset = attempt.server_time_ms - Date.now()
  }
  function goToResults() {
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
        const [response, payload] = await requestJson('POST',
          `/api/quiz/quizzes/${quizId}/attempts/${attemptId}/questions/${question.id}/start`)
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
    quizTimer.hidden = quizDeadline === null
    if (quizDeadline !== null) quizTimer.textContent = `Quiz ${clockText(remaining(quizDeadline))}`
    const question = questions[position]
    questionTimer.hidden = !question || question.timeLimit === null
    if (question?.deadline !== null && question?.deadline !== undefined) {
      questionTimer.textContent = `Question ${clockText(remaining(question.deadline))}`
    } else if (!questionTimer.hidden) questionTimer.textContent = 'Question timer starting…'
    timerArea.hidden = quizTimer.hidden && questionTimer.hidden
    if (quizDeadline !== null && remaining(quizDeadline) === 0) { void completeAttempt(true); return }
    if (question?.deadline !== null && question?.deadline !== undefined && remaining(question.deadline) === 0
        && !navigating && !expiredQuestions.has(question.id)) {
      expiredQuestions.add(question.id)
      question.lock()
      dirtyQuestions.delete(position)
      if (unlimited) setStatus(status, 'Question time is up. Select Next to continue.')
      else if (position === questionCount - 1) void completeAttempt(true)
      else void advanceQuestion(true)
    }
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
          const [response, payload] = await requestJson('PUT',
            `/api/quiz/quizzes/${quizId}/attempts/${attemptId}/answers/${question.id}`,
            { answer: question.getAnswer() })
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
    questions.forEach(({ card }, index) => { card.hidden = position !== index })
    progress.textContent = unlimited ? `Question ${position + 1} · Until you finish` : `Question ${position + 1} of ${questionCount}`
    if (!unlimited) progress.style.setProperty('--progress', `${(position / questionCount) * 100}%`)
    previous.hidden = !allowGoBack || position === 0
    next.textContent = !unlimited && position === questionCount - 1 ? 'Finish quiz' : 'Next'
    page.querySelector('.quiz-play-page').scrollIntoView({ block: 'start' })
    void startCurrentQuestion()
    tick()
  }

  previous.addEventListener('click', async () => {
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
      if (!expired) await flushAnswers()
      const [response, payload] = await requestJson('POST',
        `/api/quiz/quizzes/${quizId}/attempts/${attemptId}/complete`)
      if (!response.ok) throw new Error(responseError(response, payload))
      goToResults()
    } catch (error) {
      setStatus(status, error.message || 'Could not finish quiz. Please try again.', true)
    } finally {
      next.disabled = false
      finish.disabled = false
      navigating = false
    }
  }
  finish.addEventListener('click', () => { void completeAttempt() })
  async function advanceQuestion(expired = false) {
    if (navigating || attemptId === null) return
    if (!unlimited && position === questionCount - 1) { await completeAttempt(expired); return }
    navigating = true
    next.disabled = true
    if (!expired) markDirty(position)
    try {
      if (!expired) await flushAnswers()
      if (position === questions.length - 1) {
        const [response, payload] = await requestJson('POST',
          `/api/quiz/quizzes/${quizId}/attempts/${attemptId}/next`, { after: questions[position].id })
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
      next.disabled = false
      navigating = false
    }
  }
  next.addEventListener('click', () => { void advanceQuestion() })

  function appendQuestion(question, index, answers) {
    if (question.template === 'show_answer' && !question.config?.answer) {
      question.reveal = async () => {
        if (!await startCurrentQuestion()) throw new Error('Could not start question.')
        const [response, payload] = await requestJson('POST',
          `/api/quiz/quizzes/${quizId}/attempts/${attemptId}/questions/${question.id}/reveal`)
        if (!response.ok) { setStatus(status, responseError(response, payload), true); throw new Error('Could not reveal answer.') }
        return payload
      }
    }
    const view = { id: question.id, timeLimit: question.time_limit_seconds, started: question.started,
      deadline: question.deadline_ms, ...buildQuestion(question, index) }
    questions.push(view)
    if (answers?.[question.id]) view.restoreAnswer(answers[question.id])
    view.card.addEventListener('input', () => markDirty(index))
    view.card.addEventListener('change', () => markDirty(index))
    questionArea.append(view.card)
  }

  if (!quizId || !/^[1-9][0-9]*$/.test(quizId)) {
    setStatus(status, 'Quiz not found.', true)
    return
  }
  requestJson('GET', `/api/quiz/quizzes/${quizId}`).then(async ([quizResponse, quiz]) => {
    if (!app.contains(questionArea)) return
    if (!quizResponse.ok) { setStatus(status, responseError(quizResponse, quiz), true); return }
    title.textContent = quiz.name
    description.textContent = quiz.description || ''
    description.hidden = !quiz.description
    const [attemptResponse, attempt] = await requestJson('POST', `/api/quiz/quizzes/${quizId}/attempts`)
    if (!app.contains(questionArea)) return
    if (!attemptResponse.ok) { setStatus(status, responseError(attemptResponse, attempt), true); return }
    attemptId = attempt.id
    if (attempt.completed !== null) { goToResults(); return }
    syncAttemptClock(attempt)
    allowGoBack = attempt.allow_go_back
    page.querySelector('.quiz-play-page').classList.add(attempt.play_style === 'game_show' ? 'is-game-show' : 'is-basic')
    if (!Array.isArray(attempt.questions) || !attempt.questions.length) {
      setStatus(status, 'This quiz has no questions yet.')
      return
    }
    unlimited = attempt.question_limit === 0
    questionCount = attempt.question_count
    finish.hidden = !unlimited
    if (unlimited) progress.classList.add('is-unlimited')
    attempt.questions.forEach((question, index) => appendQuestion(question, index, attempt.answers))
    const firstUnanswered = questions.findIndex((question) =>
      !Object.prototype.hasOwnProperty.call(attempt.answers ?? {}, question.id))
    if (!allowGoBack) position = Math.max(0, Math.min(questions.length - 1, attempt.furthest_position - 1))
    else if (firstUnanswered > 0) position = firstUnanswered
    else if (firstUnanswered === -1) position = questions.length - 1
    progress.hidden = false
    controls.hidden = false
    setStatus(status, '')
    showPosition()
    tickTimer = setInterval(tick, 250)
  }).catch(() => {
    if (app.contains(questionArea)) setStatus(status, 'Could not load this quiz. Please try again.', true)
  })
}

