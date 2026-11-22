import assert from 'node:assert/strict'
import { test } from 'node:test'
import { convertTemplateConfig } from '../src/template-config.js'

test('choice templates keep option text and images while selecting one correct answer', () => {
  const current = { options: [
    { text: 'A', image_id: 11, correct: true },
    { text: 'B', correct: true },
    { text: 'C', correct: false },
  ] }
  assert.deepEqual(convertTemplateConfig('multiple_choice', 'one_choice', current), {
    options: [
      { text: 'A', image_id: 11, correct: true },
      { text: 'B', correct: false },
      { text: 'C', correct: false },
    ],
  })
  const single = convertTemplateConfig('multiple_choice', 'one_choice', current)
  assert.deepEqual(convertTemplateConfig('one_choice', 'multiple_choice', single, current), current)
})

test('switching through wheel keeps choice metadata and applies edited option text', () => {
  const choices = { options: [
    { text: 'Alpha', image_id: 12, correct: true },
    { text: 'Beta', correct: false },
  ] }
  assert.deepEqual(convertTemplateConfig('multiple_choice', 'wheel', choices), {
    options: ['Alpha', 'Beta'],
  })
  assert.deepEqual(convertTemplateConfig('wheel', 'multiple_choice',
    { options: ['Changed', 'Beta'] }, choices), {
    options: [
      { text: 'Changed', image_id: 12, correct: true },
      { text: 'Beta', correct: false },
    ],
  })
})

test('removing a temporary wheel option keeps metadata with the remaining choices', () => {
  const choices = { options: [
    { text: 'Alpha', image_id: 61, correct: true },
    { text: 'Beta', image_id: 62, correct: false },
    { text: 'Gamma', image_id: 63, correct: false },
  ] }
  assert.deepEqual(convertTemplateConfig('wheel', 'multiple_choice',
    { options: ['Gamma', 'Beta'] }, choices), {
    options: [
      { text: 'Gamma', image_id: 63, correct: false },
      { text: 'Beta', image_id: 62, correct: false },
    ],
  })
})

test('match definitions survive a temporary switch to a text list', () => {
  const match = { pairs: [
    { keyword: 'A', definition: 'First', keyword_image_id: 21, definition_image_id: 22 },
    { keyword: 'B', definition: 'Second' },
  ] }
  assert.deepEqual(convertTemplateConfig('match', 'wheel', match), { options: ['A', 'B'] })
  assert.deepEqual(convertTemplateConfig('wheel', 'match',
    { options: ['Changed', 'B'] }, match), {
    pairs: [
      { keyword: 'Changed', definition: 'First', keyword_image_id: 21, definition_image_id: 22 },
      { keyword: 'B', definition: 'Second' },
    ],
  })
})

test('ordering and categorize items carry their text and images into choices', () => {
  const ordering = { items: [{ text: 'One', image_id: 31 }, { text: 'Two' }] }
  assert.deepEqual(convertTemplateConfig('ordering', 'multiple_choice', ordering), {
    options: [
      { text: 'One', image_id: 31, correct: false },
      { text: 'Two', correct: false },
    ],
  })
  const categorized = { categories: [
    { name: 'First', items: [{ text: 'Red', image_id: 41 }] },
    { name: 'Second', items: [{ text: 'Blue' }] },
  ] }
  assert.deepEqual(convertTemplateConfig('categorize', 'wheel', categorized), {
    options: ['Red', 'Blue'],
  })
})

test('blank answers keep images and restore choice correctness on return', () => {
  const choices = { options: [
    { text: 'First', image_id: 51, correct: true },
    { text: 'Second', correct: false },
  ] }
  const blanks = convertTemplateConfig('multiple_choice', 'fill_blanks', choices)
  assert.deepEqual(blanks, { answers: [
    { text: 'First', image_id: 51 }, { text: 'Second' },
  ] })
  blanks.answers[0].text = 'Edited'
  assert.deepEqual(convertTemplateConfig('fill_blanks', 'multiple_choice', blanks, choices), {
    options: [
      { text: 'Edited', image_id: 51, correct: true },
      { text: 'Second', correct: false },
    ],
  })
})

test('category names and groups survive edits in a temporary wheel', () => {
  const categorized = { categories: [
    { name: 'Warm', items: [{ text: 'Red' }] },
    { name: 'Cool', items: [{ text: 'Blue' }] },
  ] }
  const converted = convertTemplateConfig('wheel', 'categorize',
    { options: ['Orange', 'Blue'] }, categorized)
  assert.deepEqual(converted.categories, [
    { name: 'Warm', items: [{ text: 'Orange' }] },
    { name: 'Cool', items: [{ text: 'Blue' }] },
  ])
})

test('switching back from a template without options restores its cached draft', () => {
  const choices = { options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] }
  assert.deepEqual(convertTemplateConfig('no_answer', 'multiple_choice', {}, choices), choices)
  assert.deepEqual(convertTemplateConfig('short_answer', 'multiple_choice',
    { answer: 'Changed answer' }, choices), choices)
})

test('diagram conversion keeps the supported labels and restores hidden tail options', () => {
  const wheel = { options: Array.from({ length: 32 }, (_, index) => `Option ${index + 1}`) }
  const diagram = convertTemplateConfig('wheel', 'labeled_diagram', wheel)
  assert.equal(diagram.labels.length, 30)
  diagram.labels[0].text = 'Changed'
  const restored = convertTemplateConfig('labeled_diagram', 'wheel', diagram, wheel)
  assert.equal(restored.options.length, 32)
  assert.equal(restored.options[0], 'Changed')
  assert.equal(restored.options[31], 'Option 32')
})
