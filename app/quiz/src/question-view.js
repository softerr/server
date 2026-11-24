import { moveDownIcon, moveUpIcon } from './icons.js'
import { showMissingImageWhenUnavailable } from './missing-image.js'
import { mediaImageUrl } from '@softerr/shared/media-client.js'
import { makeScrollableDrag } from './pointer-drag.js'
import { createWheelActivity } from './wheel.js'
import { createCrosswordActivity } from './crossword.js'

const templateNames = {
  multiple_choice: 'Multiple choice', one_choice: 'One choice', number: 'Number',
  short_answer: 'Short answer', open: 'Open answer', true_false: 'True/false',
  yes_no: 'Yes/no', show_answer: 'Show answer', no_answer: 'No answer', wheel: 'Wheel',
  match: 'Match', ordering: 'Ordering', fill_blanks: 'Fill in the blanks',
  categorize: 'Categorize', labeled_diagram: 'Labeled diagram', crossword: 'Crossword',
}

const imageUrl = mediaImageUrl

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
    showMissingImageWhenUnavailable(image)
    image.src = imageUrl(imageId)
    image.alt = text ? '' : 'Image'
    image.loading = 'lazy'
    image.draggable = false
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
    card.classList.add(`play-tone-${itemIndex % 4}`)
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
    makeScrollableDrag(card, {
      canDrag: () => !locked,
      targetAt: (x, y) => {
        const target = document.elementFromPoint(x, y)?.closest('.play-drop-zone, .play-drag-bank')
        return area.contains(target) ? target : null
      },
      drop: (target) => place(card, target),
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
  const correctCount = () => cards.filter((card, index) =>
    card.parentElement?.dataset.target === String(items[index].target)).length
  return {
    grade: () => correctCount() === cards.length,
    correctCount,
    finish: () => { locked = true; cards.forEach((card) => { card.disabled = true }) },
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

function diagramAssignment(answer, config) {
  const labels = config.labels || []
  const points = config.points || labels
  const order = config.choices ? config.choices.map((_, index) => index) : shuffledIndexes(labels.length)
  const items = order.map((index) => ({
    text: config.choices ? config.choices[index] : labels[index].text,
    target: config.choices ? null : index,
  }))
  const area = element('div', 'play-diagram-activity')
  const instruction = element('p', 'play-instruction', 'Drag a label to a numbered point, or select a label and then a point.')
  const bank = element('div', 'play-drag-bank')
  bank.setAttribute('aria-label', 'Diagram labels')
  const canvas = element('div', 'play-diagram-canvas')
  const image = element('img', 'play-diagram-image')
  showMissingImageWhenUnavailable(image)
  image.src = imageUrl(config.diagram_image_id)
  image.alt = 'Diagram to label'
  image.draggable = false
  const markers = element('div', 'play-diagram-markers')
  canvas.append(image, markers)
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
    if (target !== bank) {
      const existing = target.querySelector('.play-drag-card')
      if (existing && existing !== card) bank.append(existing)
    }
    target.append(card)
    selected?.classList.remove('is-selected')
    selected = null
    area.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const cards = items.map((item, index) => {
    const card = element('button', 'play-drag-card', item.text)
    card.type = 'button'
    card.dataset.source = String(index)
    bank.append(card)
    card.addEventListener('click', () => {
      if (card.parentElement !== bank && selected !== card) {
        bank.append(card)
        choose(null)
        area.dispatchEvent(new Event('change', { bubbles: true }))
      } else choose(card)
    })
    makeScrollableDrag(card, {
      canDrag: () => !locked,
      targetAt: (x, y) => {
        const target = document.elementFromPoint(x, y)?.closest('.play-diagram-point, .play-drag-bank')
        return area.contains(target) ? target : null
      },
      drop: (target) => place(card, target),
    })
    return card
  })
  const zones = points.map((point, index) => {
    const zone = element('div', 'play-diagram-point')
    zone.dataset.point = String(index)
    zone.style.left = `${point.x}%`
    zone.style.top = `${point.y}%`
    if (point.x < 25) zone.classList.add('is-left-edge')
    if (point.x > 75) zone.classList.add('is-right-edge')
    zone.tabIndex = 0
    zone.setAttribute('role', 'button')
    zone.setAttribute('aria-label', `Place label at point ${index + 1}`)
    zone.append(element('span', 'play-diagram-number', String(index + 1)))
    zone.addEventListener('click', (event) => {
      if (!event.target.closest('.play-drag-card')) place(selected, zone)
    })
    zone.addEventListener('keydown', (event) => {
      if (event.target === zone && (event.key === 'Enter' || event.key === ' ') && selected) {
        event.preventDefault()
        place(selected, zone)
      }
    })
    markers.append(zone)
    return zone
  })
  bank.addEventListener('click', (event) => {
    if (!event.target.closest('.play-drag-card')) place(selected, bank)
  })
  area.append(instruction, bank, canvas)
  answer.append(area)
  const correctCount = () => items.filter((item, index) =>
    cards[index].parentElement?.dataset.point === String(item.target)).length
  return {
    grade: () => config.choices ? null : correctCount() === items.length,
    diagramScore: () => config.choices ? null : { correct: correctCount(), total: items.length },
    displayOrder: [...order],
    finish: () => { locked = true; cards.forEach((card) => { card.disabled = true }) },
    getAnswer: () => ({ assignments: zones.map((zone) => {
      const source = zone.querySelector('.play-drag-card')?.dataset.source
      return source === undefined ? null : source
    }) }),
    restoreAnswer: (saved) => {
      cards.forEach((card) => bank.append(card))
      if (!Array.isArray(saved?.assignments)) return
      saved.assignments.forEach((source, point) => {
        if (source === null || !/^(0|[1-9][0-9]*)$/.test(String(source))) return
        const card = cards[Number(source)]
        if (zones[point] && card && card.parentElement === bank) zones[point].append(card)
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
  let canContinue = () => true
  let onLock = () => {}
  let finish = () => {}
  let getAnswer = () => ({ viewed: true })
  let restoreAnswer = () => {}
  let matchScore = null
  let diagramScore = null
  let displayOrder = null

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
  } else if (question.template === 'wheel') {
    const activity = createWheelActivity(answer, config.options || [])
    grade = activity.grade
    canContinue = activity.canContinue
    finish = activity.finish
    onLock = activity.finish
    getAnswer = activity.getAnswer
    restoreAnswer = activity.restoreAnswer
  } else if (question.template === 'crossword') {
    const activity = createCrosswordActivity(answer, config)
    grade = activity.grade
    getAnswer = activity.getAnswer
    restoreAnswer = activity.restoreAnswer
  } else if (question.template === 'match') {
    const pairs = config.pairs || []
    const definitions = config.definitions || pairs
    const activity = dragAssignment(answer,
      (config.definitions ? pairs.map((_, index) => index) : shuffledIndexes(pairs.length)).map((pairIndex) => ({
        text: definitions[pairIndex].definition, imageId: definitions[pairIndex].definition_image_id,
        target: pairIndex, source: pairIndex,
      })),
      pairs.map((pair) => ({ text: pair.keyword, imageId: pair.keyword_image_id })), 1)
    grade = activity.grade
    finish = activity.finish
    matchScore = () => ({ correct: activity.correctCount(), total: pairs.length })
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
  } else if (question.template === 'labeled_diagram') {
    const activity = diagramAssignment(answer, config)
    grade = activity.grade
    finish = activity.finish
    getAnswer = activity.getAnswer
    restoreAnswer = activity.restoreAnswer
    diagramScore = activity.diagramScore
    displayOrder = activity.displayOrder
  } else if (question.template === 'ordering') {
    const items = config.items || []
    const order = config._ordered_for_play ? items.map((_, index) => index) : shuffledIndexes(items.length)
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
        makeScrollableDrag(row, {
          canDrag: () => !orderLocked,
          ignoreStart: (target) => Boolean(target.closest('button')),
          targetAt: (x, y) => {
            const target = document.elementFromPoint(x, y)?.closest('.play-order-row')
            return rows.contains(target) ? target : null
          },
          drop: (target) => {
            if (orderLocked) return
            const from = order.indexOf(itemIndex)
            const position = [...rows.querySelectorAll('.play-order-row')].indexOf(target)
            if (from < 0 || position < 0 || from === position) return
            order.splice(position, 0, ...order.splice(from, 1))
            renderOrder()
            card.dispatchEvent(new Event('change', { bubbles: true }))
          },
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
    const activity = dragAssignment(answer, (config.items ? items.map((_, index) => index) : shuffledIndexes(items.length)).map((i) => items[i]),
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
  const solutionImage = config.answer_image_id && !['show_answer', 'open', 'no_answer', 'wheel'].includes(question.template)
    ? rich('', config.answer_image_id) : null
  if (solutionImage) { solutionImage.hidden = true; card.append(solutionImage) }
  return {
    card,
    getAnswer,
    restoreAnswer,
    canContinue,
    matchScore,
    diagramScore,
    displayOrder,
    lock() {
      onLock()
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

