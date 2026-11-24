import assert from 'node:assert/strict'
import test from 'node:test'
import { bindPointerDrag, scrollNearPointer } from '../pointer-drag.js'

function eventTarget() {
  const listeners = new Map()
  let captured = null
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    dispatch(type, values = {}) {
      let prevented = false
      const event = { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10,
        preventDefault() { prevented = true }, stopPropagation() {}, ...values }
      for (const listener of listeners.get(type) ?? []) listener(event)
      return prevented
    },
    setPointerCapture(id) { captured = id },
    hasPointerCapture(id) { return captured === id },
    releasePointerCapture(id) {
      if (captured !== id) return
      captured = null
      this.dispatch('lostpointercapture', { pointerId: id })
    },
  }
}

test('pointer drag starts after movement, commits once, and cancels on Escape', () => {
  const previousDocument = globalThis.document
  globalThis.document = eventTarget()
  try {
    const source = eventTarget()
    const results = []
    bindPointerDrag(source, {
      canStart: () => true, onDown() {}, onStart() {}, onMove() {},
      onFinish(drag, committed) { results.push([drag.started, committed]) },
    })
    source.dispatch('pointerdown')
    source.dispatch('pointermove', { clientX: 13 })
    source.dispatch('pointerup', { clientX: 13 })
    assert.deepEqual(results, [[false, false]])
    source.dispatch('pointerdown')
    source.dispatch('pointermove', { clientX: 20 })
    source.dispatch('pointerup', { clientX: 20 })
    assert.deepEqual(results.at(-1), [true, true])
    assert.equal(results.length, 2)
    source.dispatch('pointerdown')
    source.dispatch('pointermove', { clientX: 20 })
    globalThis.document.dispatch('keydown', { key: 'Escape' })
    source.dispatch('pointerup', { clientX: 20 })
    assert.deepEqual(results.at(-1), [true, false])
    assert.equal(results.length, 3)
    source.dispatch('pointerdown')
    source.dispatch('pointermove', { clientX: 20 })
    source.dispatch('lostpointercapture')
    source.dispatch('pointerup', { clientX: 20 })
    assert.deepEqual(results.at(-1), [true, false])
    assert.equal(results.length, 4)
  } finally {
    globalThis.document = previousDocument
  }
})

test('edge scrolling supports vertical and horizontal containers', () => {
  const scroller = { scrollTop: 50, scrollLeft: 50,
    scrollHeight: 500, clientHeight: 100, scrollWidth: 500, clientWidth: 100 }
  const bounds = { left: 0, right: 100, top: 0, bottom: 100 }
  scrollNearPointer(scroller, bounds, 50, 5)
  assert.ok(scroller.scrollTop < 50)
  scrollNearPointer(scroller, bounds, 95, 50, { axis: 'x' })
  assert.ok(scroller.scrollLeft > 50)
  const previous = scroller.scrollTop
  scrollNearPointer(scroller, bounds, 50, 50)
  scrollNearPointer(scroller, bounds, 50, -5)
  assert.equal(scroller.scrollTop, previous)
})
