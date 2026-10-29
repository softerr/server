import assert from 'node:assert/strict'
import test from 'node:test'
import { bindMediaCardSelection } from '../../app/home/src/media-selection.js'

function setup() {
  const selected = new Set()
  const anchor = { id: null }
  const cards = []
  const grid = { querySelectorAll: () => cards }
  let changes = 0
  const busy = () => false
  for (const id of [1, 2, 3, 4]) {
    const handlers = new Map()
    const classes = new Set()
    const card = {
      dataset: {},
      classList: {
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name) },
        contains(name) { return classes.has(name) },
      },
      querySelector: () => ({ draggable: true }),
      setAttribute(name, value) { this[name] = value },
      addEventListener(type, handler) { handlers.set(type, handler) },
      emit(type, options = {}) {
        const event = {
          target: { closest: () => null },
          preventDefault() {},
          ...options,
        }
        handlers.get(type)(event)
      },
    }
    bindMediaCardSelection(card, { id, name: `Image ${id}` }, {
      grid, selected, anchor, visibleIds: () => cards.map((item) => Number(item.dataset.mediaCardId)),
      busy, changed: () => { changes++ },
    })
    cards.push(card)
  }
  return { cards, selected, anchor, changes: () => changes }
}

test('Ctrl click toggles items, Ctrl Shift click selects a visible range, plain click exits selection', () => {
  const { cards, selected, anchor } = setup()
  cards[0].emit('click', { ctrlKey: true })
  cards[3].emit('click', { ctrlKey: true, shiftKey: true })
  assert.deepEqual([...selected], [1, 2, 3, 4])
  assert.equal(cards[2].classList.contains('is-selected'), true)
  assert.equal(cards[2]['aria-label'], 'Selected Image 3')
  cards[1].emit('click', { ctrlKey: true })
  assert.deepEqual([...selected], [1, 3, 4])
  cards[2].emit('click')
  assert.equal(selected.size, 0)
  assert.equal(anchor.id, null)
})

test('long press selects once; moving the pointer cancels the press', () => {
  const original = globalThis.setTimeout
  const originalClear = globalThis.clearTimeout
  let press = null
  globalThis.setTimeout = (callback) => { press = callback; return 1 }
  globalThis.clearTimeout = () => { press = null }
  try {
    const { cards, selected, changes } = setup()
    cards[0].emit('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 5 })
    cards[0].emit('pointermove', { clientX: 20, clientY: 0, pointerId: 5 })
    assert.equal(press, null)
    cards[0].emit('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 5 })
    press()
    assert.deepEqual([...selected], [1])
    cards[0].emit('click')
    assert.deepEqual([...selected], [1])
    assert.equal(changes(), 1)
  } finally {
    globalThis.setTimeout = original
    globalThis.clearTimeout = originalClear
  }
})

test('Space selects a focused card and Escape clears selection', () => {
  const { cards, selected } = setup()
  cards[1].emit('keydown', { target: cards[1], key: ' ' })
  assert.deepEqual([...selected], [2])
  cards[1].emit('keydown', { target: cards[1], key: 'Escape' })
  assert.equal(selected.size, 0)
})
