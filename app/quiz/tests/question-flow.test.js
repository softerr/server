import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuestionFlow } from '../src/question-flow.js'

function unspunWheel() {
  let locked = false
  return {
    canContinue: () => false,
    lock: () => { locked = true },
    isLocked: () => locked,
  }
}

function timers() {
  return { timerArea: { hidden: true }, quizTimer: { hidden: true },
    questionTimer: { hidden: true, textContent: '' } }
}

test('a timed out wheel advances through the same Next path in a fixed-length quiz', () => {
  const wheel = unspunWheel()
  const nextButton = { disabled: false }
  const finishButton = { disabled: false }
  const { timerArea, quizTimer, questionTimer } = timers()
  const advances = []
  const flow = createQuestionFlow({
    currentQuestion: () => wheel,
    isUnlimited: () => false,
    isLast: () => false,
    nextButton, finishButton,
    timerArea, quizTimer, questionTimer,
    onAdvance: (expired) => { advances.push(expired) },
    onFinish: () => { throw new Error('Unexpected finish') },
  })

  flow.updateControls()
  assert.equal(nextButton.disabled, true)
  flow.next()
  assert.deepEqual(advances, [])

  flow.tick({ quizDeadline: null, questionDeadline: 1000, questionTimeLimit: 1, now: 1000 })
  assert.equal(wheel.isLocked(), true)
  assert.equal(nextButton.disabled, false)
  assert.equal(questionTimer.textContent, 'Question 00:00')
  assert.equal(timerArea.hidden, false)
  assert.deepEqual(advances, [true])
  flow.next()
  assert.deepEqual(advances, [true, true])
  flow.tick({ quizDeadline: null, questionDeadline: 1000, questionTimeLimit: 1, now: 2000 })
  assert.deepEqual(advances, [true, true])
})

test('an expired final wheel can finish without a spin', () => {
  const wheel = unspunWheel()
  const finishes = []
  const flow = createQuestionFlow({
    currentQuestion: () => wheel,
    isUnlimited: () => false,
    isLast: () => true,
    nextButton: { disabled: false }, finishButton: { disabled: false },
    ...timers(),
    onAdvance: () => { throw new Error('Unexpected advance') },
    onFinish: (expired) => { finishes.push(expired) },
  })

  flow.tick({ quizDeadline: null, questionDeadline: 1000, questionTimeLimit: 1, now: 1000 })
  assert.deepEqual(finishes, [true])
  flow.finish()
  assert.deepEqual(finishes, [true, true])
})

test('an expired wheel in an unlimited quiz waits for Next or Finish', () => {
  const wheel = unspunWheel()
  const nextButton = { disabled: true }
  const finishButton = { disabled: true }
  const actions = []
  const flow = createQuestionFlow({
    currentQuestion: () => wheel,
    isUnlimited: () => true,
    isLast: () => true,
    nextButton, finishButton,
    ...timers(),
    onAdvance: (expired) => { actions.push(['next', expired]) },
    onFinish: (expired) => { actions.push(['finish', expired]) },
  })

  flow.tick({ quizDeadline: null, questionDeadline: 1000, questionTimeLimit: 1, now: 1000 })
  assert.deepEqual(actions, [])
  assert.equal(nextButton.disabled, false)
  assert.equal(finishButton.disabled, false)
  flow.next()
  flow.finish()
  assert.deepEqual(actions, [['next', true], ['finish', true]])
})

test('the whole-quiz deadline finishes an unspun wheel without expiring the question', () => {
  const wheel = unspunWheel()
  const finishes = []
  const flow = createQuestionFlow({
    currentQuestion: () => wheel,
    isUnlimited: () => true,
    isLast: () => false,
    nextButton: { disabled: true }, finishButton: { disabled: true },
    ...timers(),
    onAdvance: () => { throw new Error('Unexpected advance') },
    onFinish: (expired) => { finishes.push(expired) },
  })

  flow.tick({ quizDeadline: 1000, questionDeadline: 5000, questionTimeLimit: 5, now: 1000 })
  assert.deepEqual(finishes, [true])
  assert.equal(wheel.isLocked(), false)
})
