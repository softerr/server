import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutCrossword, normalizeCrosswordAnswer, numberedCrosswordEntries } from '../src/crossword-layout.js'

test('crossword layout crosses matching letters and numbers clues by grid position', () => {
  const entries = layoutCrossword([
    { answer: 'cat', clue: 'Feline' },
    { answer: 'tar', clue: 'Road material' },
    { answer: 'dog', clue: 'Canine' },
  ])
  assert.deepEqual(entries.map((entry) => entry.answer), ['CAT', 'TAR', 'DOG'])
  const cells = new Map()
  let crossings = 0
  for (const entry of entries) {
    for (const [index, letter] of [...entry.answer].entries()) {
      const row = entry.row + (entry.direction === 'down' ? index : 0)
      const col = entry.col + (entry.direction === 'across' ? index : 0)
      const key = `${row},${col}`
      if (cells.has(key)) { assert.equal(cells.get(key), letter); crossings++ }
      else cells.set(key, letter)
    }
  }
  assert.ok(crossings > 0)
  assert.ok(numberedCrosswordEntries(entries).every((entry) => Number.isInteger(entry.number)))
})

test('crossword answers normalize Latin accents and reject unsupported characters', () => {
  assert.equal(normalizeCrosswordAnswer('  Café-au-lait '), 'CAFEAULAIT')
  assert.equal(normalizeCrosswordAnswer('東京'), '')
  assert.throws(() => layoutCrossword([
    { answer: 'CAT' }, { answer: 'CAT' },
  ]), /distinct/)
})
