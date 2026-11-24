import { showMissingImageWhenUnavailable } from './missing-image.js'
import { mediaImageUrl } from '@softerr/shared/media-client.js'
import { numberedCrosswordEntries } from './crossword-layout.js'

function element(tag, className = '', text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function answerContent(text, imageId) {
  const content = element('span', 'review-answer-content')
  if (text) content.append(element('span', '', text))
  if (imageId) {
    const image = element('img', 'review-answer-image')
    showMissingImageWhenUnavailable(image)
    image.src = mediaImageUrl(imageId)
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
    case 'labeled_diagram':
      for (const [index, label] of (config.labels || []).entries()) {
        row(element('strong', '', `${index + 1}.`), answerContent(label.text))
      }
      break
    case 'crossword':
      for (const entry of numberedCrosswordEntries(config.entries || [])) {
        row(element('strong', '', `${entry.number} ${entry.direction} · ${entry.clue}:`),
          answerContent(entry.answer))
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

function markReviewedDiagram(card, question, savedAnswer) {
  const labels = question.solution?.labels || []
  const order = question.solution?._display_order || labels.map((_, index) => index)
  card.querySelectorAll('.play-diagram-point').forEach((point, index) => {
    const correct = String(savedAnswer?.assignments?.[index]) === String(order.indexOf(index))
    point.classList.add(correct ? 'is-review-correct' : 'is-review-incorrect')
    point.setAttribute('aria-description', correct ? 'Correct label' : 'Incorrect label')
    if (!correct && labels[index]) {
      point.append(element('span', 'review-diagram-correction', `Correct: ${labels[index].text}`))
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

export function decorateReviewedQuestion(view, question, savedAnswer, result, hasAnswer = true) {
  const card = view.card
  if (['multiple_choice', 'one_choice', 'true_false', 'yes_no'].includes(question.template)) {
    markReviewedChoices(card, question)
  } else if (question.template === 'match') {
    markReviewedMatch(card, question, savedAnswer)
  } else if (question.template === 'labeled_diagram' && !question.solution?.choices) {
    markReviewedDiagram(card, question, savedAnswer)
  } else if (question.template === 'categorize') {
    markReviewedCategories(card, question, savedAnswer)
  } else if (question.template === 'fill_blanks') {
    markReviewedBlanks(card, question)
  } else if (question.template === 'ordering' && hasAnswer
    && markReviewedOrdering(card, question, savedAnswer)) {
    // The selected order is shown in place, with corrections beside wrong positions.
  } else if (['number', 'short_answer'].includes(question.template) && hasAnswer) {
    markReviewedTextAnswer(card, question, result)
  } else {
    const solution = correctAnswers(question)
    if (solution) card.append(solution)
  }
}

