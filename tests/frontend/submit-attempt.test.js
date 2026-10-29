import assert from 'node:assert/strict'
import test from 'node:test'
import { submitAttempt } from '../../app/quiz/src/submit-attempt.js'

test('a failed time update still completes after the answer is saved', async () => {
  const calls = []
  const result = await submitAttempt({
    saveAnswers: async () => { calls.push('answers') },
    saveTime: async () => { calls.push('time'); throw new Error('Timing unavailable') },
    complete: async () => { calls.push('complete'); return { completed: true } },
  })
  assert.deepEqual(calls, ['answers', 'time', 'complete'])
  assert.deepEqual(result, { completed: true })
})

test('a pending time update cannot hold up completion', async () => {
  let resolveTime
  const pendingTime = new Promise((resolve) => { resolveTime = resolve })
  const result = await submitAttempt({
    saveTime: () => pendingTime,
    complete: async () => 'completed',
  })
  assert.equal(result, 'completed')
  resolveTime()
})

test('an answer save failure still blocks completion', async () => {
  const calls = []
  await assert.rejects(submitAttempt({
    saveAnswers: async () => { calls.push('answers'); throw new Error('Answer not saved') },
    saveTime: async () => { calls.push('time') },
    complete: async () => { calls.push('complete') },
  }), /Answer not saved/)
  assert.deepEqual(calls, ['answers'])
})

test('a completion failure remains visible to the caller', async () => {
  await assert.rejects(submitAttempt({
    saveTime: async () => {},
    complete: async () => { throw new Error('Completion unavailable') },
  }), /Completion unavailable/)
})
