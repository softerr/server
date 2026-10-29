import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreviewQuestionSequence } from '../../app/quiz/src/question-sequence.js'

const questions = [{ id: 1 }, { id: 2 }, { id: 3 }]
const asked = (sequence, count) => Array.from({ length: count }, () => sequence.next().id)

test('All asks every question once, even when randomized', () => {
  const sequence = createPreviewQuestionSequence(questions,
    { question_limit: null, randomize_questions: true }, () => 0)
  assert.equal(sequence.initialCount, 3)
  assert.deepEqual(new Set(asked(sequence, 3)), new Set([1, 2, 3]))
})

test('Until finish follows quiz order and wraps around', () => {
  const sequence = createPreviewQuestionSequence(questions,
    { question_limit: 0, randomize_questions: false })
  assert.equal(sequence.initialCount, 1)
  assert.deepEqual(asked(sequence, 7), [1, 2, 3, 1, 2, 3, 1])
})

test('randomized repeated questions never appear back to back when alternatives exist', () => {
  for (const limit of [0, 30]) {
    const sequence = createPreviewQuestionSequence(questions,
      { question_limit: limit, randomize_questions: true }, () => 0)
    const ids = asked(sequence, 30)
    assert.ok(ids.every((id, index) => index === 0 || id !== ids[index - 1]))
  }
  const singleton = createPreviewQuestionSequence([questions[0]],
    { question_limit: 0, randomize_questions: true }, () => 0)
  assert.deepEqual(asked(singleton, 3), [1, 1, 1])
})
