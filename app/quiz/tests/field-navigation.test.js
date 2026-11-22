import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enableFieldNavigation, removeEmptyRowOnBackspace } from '../src/field-navigation.js'

test('left and right arrows move between fields in the same row at caret boundaries', () => {
  let focused = null
  function field(value, left, top) {
    const rect = { left, right: left + 100, top, bottom: top + 30, height: 30 }
    return {
      type: 'text', tagName: 'INPUT', value, selectionStart: 0, selectionEnd: 0, disabled: false,
      matches: () => true,
      getClientRects: () => [rect],
      getBoundingClientRect: () => rect,
      focus() { focused = this },
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end },
    }
  }
  const left = field('Keyword', 0, 0)
  const right = field('Definition', 120, 0)
  const nextLeft = field('Next keyword', 0, 50)
  const nextRight = field('Next definition', 120, 50)
  let keydown = null
  const form = {
    addEventListener: (_, listener) => { keydown = listener },
    contains: () => true,
    querySelectorAll: () => [left, right, nextLeft, nextRight],
  }
  enableFieldNavigation(form)
  function press(target, key) {
    let prevented = false
    keydown({ target, key, preventDefault() { prevented = true } })
    return prevented
  }

  left.setSelectionRange(3, 3)
  assert.equal(press(left, 'ArrowRight'), false)
  assert.equal(focused, null)

  left.setSelectionRange(left.value.length, left.value.length)
  assert.equal(press(left, 'ArrowRight'), true)
  assert.equal(focused, right)
  assert.equal(right.selectionStart, right.value.length)

  right.setSelectionRange(0, 0)
  assert.equal(press(right, 'ArrowLeft'), true)
  assert.equal(focused, left)
  assert.equal(left.selectionStart, 0)

  right.disabled = true
  left.setSelectionRange(left.value.length, left.value.length)
  assert.equal(press(left, 'ArrowRight'), false)
  assert.equal(focused, left)
})

test('down, up, and Enter stay in the same column of match rows', () => {
  let focused = null
  function field(left, top) {
    const rect = { left, right: left + 100, top, bottom: top + 30, height: 30 }
    return {
      type: 'text', tagName: 'INPUT', value: '', selectionStart: 0, selectionEnd: 0, disabled: false,
      matches: () => true,
      getClientRects: () => [rect],
      getBoundingClientRect: () => rect,
      focus() { focused = this },
    }
  }
  const topLeft = field(0, 0)
  const topRight = field(120, 0)
  const bottomLeft = field(0, 50)
  const bottomRight = field(120, 50)
  let keydown = null
  enableFieldNavigation({
    addEventListener: (_, listener) => { keydown = listener },
    contains: () => true,
    querySelectorAll: () => [topLeft, topRight, bottomLeft, bottomRight],
  })
  function press(target, key) {
    let prevented = false
    keydown({ target, key, preventDefault() { prevented = true } })
    assert.equal(prevented, true)
  }

  press(topLeft, 'ArrowDown')
  assert.equal(focused, bottomLeft)
  press(topRight, 'ArrowDown')
  assert.equal(focused, bottomRight)
  press(bottomRight, 'ArrowUp')
  assert.equal(focused, topRight)
  press(topLeft, 'Enter')
  assert.equal(focused, bottomLeft)
})

test('Backspace removes a fully empty row and focuses the previous field', () => {
  let keydown = null
  let removed = 0
  let focused = false
  const input = { value: '', addEventListener: (_, listener) => { keydown = listener } }
  const image = { value: '' }
  const previous = {
    value: 'Previous',
    focus() { focused = true },
    setSelectionRange(start, end) { assert.equal(start, 8); assert.equal(end, 8) },
  }
  const remove = { disabled: false, click() { removed++ } }
  const row = {
    querySelectorAll: () => [input, image],
    querySelector: () => remove,
    previousElementSibling: { querySelector: () => previous },
  }
  removeEmptyRowOnBackspace(input, row)
  function press() {
    let prevented = false
    keydown({ key: 'Backspace', preventDefault() { prevented = true } })
    return prevented
  }

  image.value = '42'
  assert.equal(press(), false)
  image.value = ''
  remove.disabled = true
  assert.equal(press(), false)
  remove.disabled = false
  assert.equal(press(), true)
  assert.equal(removed, 1)
  assert.equal(focused, true)
})
