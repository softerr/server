import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRowReorderHandle } from '../src/reorder-rows.js'

test('captured pointer drops follow the insertion line through repeated moves', () => {
  function element() {
    const listeners = new Map()
    let captured = null
    return {
      dataset: {},
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type).add(listener)
      },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
      dispatch(type, values = {}) {
        const event = {
          isPrimary: true, button: 0, pointerId: 1,
          preventDefault() {}, ...values,
        }
        for (const listener of listeners.get(type) ?? []) listener(event)
      },
      setAttribute() {},
      setPointerCapture(id) { captured = id },
      hasPointerCapture(id) { return captured === id },
      releasePointerCapture(id) {
        if (captured !== id) return
        captured = null
        this.dispatch('lostpointercapture', { pointerId: id })
      },
      focus() {},
    }
  }

  const originalDocument = globalThis.document
  const originalFrame = globalThis.requestAnimationFrame
  const originalCancelFrame = globalThis.cancelAnimationFrame
  const document = element()
  document.createElement = element
  globalThis.document = document
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  try {
    const rows = {
      children: [], isConnected: true,
      get firstElementChild() { return this.children[0] ?? null },
      get lastElementChild() { return this.children.at(-1) ?? null },
      nextElementSibling: {
        matches: () => true,
        getBoundingClientRect: () => ({ bottom: 200 }),
      },
      insertBefore(source, reference) {
        this.children.splice(this.children.indexOf(source), 1)
        const index = reference ? this.children.indexOf(reference) : this.children.length
        this.children.splice(index, 0, source)
      },
    }
    function row(name) {
      const item = element()
      item.name = name
      item.parentElement = rows
      item.getBoundingClientRect = () => {
        const top = rows.children.indexOf(item) * 48
        return { left: 0, right: 200, top, bottom: top + 40, height: 40 }
      }
      Object.defineProperties(item, {
        previousElementSibling: { get: () => rows.children[rows.children.indexOf(item) - 1] ?? null },
        nextElementSibling: { get: () => rows.children[rows.children.indexOf(item) + 1] ?? null },
      })
      rows.children.push(item)
      return item
    }
    const first = row('first')
    const second = row('second')
    const third = row('third')
    document.elementFromPoint = (x, y) => rows.children.find((item) => {
      const bounds = item.getBoundingClientRect()
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
    }) ?? document

    let updates = 0
    const handle = createRowReorderHandle(first, rows, () => { updates++ })
    const secondHandle = createRowReorderHandle(second, rows, () => { updates++ })
    const thirdHandle = createRowReorderHandle(third, rows, () => { updates++ })
    assert.equal(handle.draggable, false)
    function drag(sourceHandle, fromY, toX, toY, markerRow, side) {
      sourceHandle.dispatch('pointerdown', { target: sourceHandle, clientX: 10, clientY: fromY })
      sourceHandle.dispatch('pointermove', { target: sourceHandle, clientX: toX, clientY: toY })
      if (markerRow) assert.equal(markerRow.dataset.dropSide, side)
      sourceHandle.dispatch('pointerup', { target: sourceHandle, clientX: toX, clientY: toY })
    }

    drag(handle, 20, 10, 49, second, 'after')
    assert.deepEqual(rows.children.map((item) => item.name), ['second', 'first', 'third'])

    drag(secondHandle, 20, 10, 190, third, 'after')
    assert.deepEqual(rows.children.map((item) => item.name), ['first', 'third', 'second'])

    drag(secondHandle, 116, 10, 44, third, 'before')
    assert.deepEqual(rows.children.map((item) => item.name), ['first', 'second', 'third'])

    drag(thirdHandle, 116, 10, 35, first, 'after')
    assert.deepEqual(rows.children.map((item) => item.name), ['first', 'third', 'second'])
    drag(secondHandle, 116, 10, 49, third, 'before')
    assert.deepEqual(rows.children.map((item) => item.name), ['first', 'second', 'third'])
    assert.equal(updates, 5)

    drag(handle, 20, -100, -100, null, null)
    assert.deepEqual(rows.children.map((item) => item.name), ['first', 'second', 'third'])
    assert.equal(updates, 5)
  } finally {
    globalThis.document = originalDocument
    globalThis.requestAnimationFrame = originalFrame
    globalThis.cancelAnimationFrame = originalCancelFrame
  }
})
