import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreviewSource } from '../src/preview-source.js'

test('preview presentation leaves unsaved editor questions intact', () => {
  const quiz = { question_limit: 0, randomize_questions: false, randomize_answers: true }
  const questions = [{ template: 'one_choice', prompt: 'Choose one',
    config: { options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] } }]
  const original = structuredClone(questions)
  const source = createPreviewSource(quiz, questions)
  const first = source.nextQuestion()
  const second = source.nextQuestion()

  assert.equal(source.initialCount, 1)
  assert.notStrictEqual(first.config, questions[0].config)
  assert.notStrictEqual(second.config, first.config)
  assert.deepEqual(first.config.options.map((option) => option.text).sort(), ['A', 'B'])
  assert.deepEqual(questions, original)
})
