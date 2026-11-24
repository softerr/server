import assert from 'node:assert/strict'
import test from 'node:test'
import { makeScrollableDrag } from '../src/pointer-drag.js'

function target() {
  const listeners = new Map()
  let captured = null
  return {
    style: {}, classList: { add() {}, remove() {} },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    dispatch(type, values = {}) {
      const event = { isPrimary: true, button: 0, pointerId: 1, clientX: 50, clientY: 50,
        target: this, preventDefault() {}, stopPropagation() {}, ...values }
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    closest: () => null,
    cloneNode: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, remove() {} }),
    setPointerCapture(id) { captured = id },
    hasPointerCapture(id) { return captured === id },
    releasePointerCapture(id) { if (captured === id) captured = null },
  }
}

test('quiz play drag keeps edge scrolling and drops at the pointer', () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousFrame = globalThis.requestAnimationFrame
  const previousCancelFrame = globalThis.cancelAnimationFrame
  const frames = new Map()
  let nextFrame = 0
  const document = target()
  document.body = { append() {} }
  document.scrollingElement = { scrollTop: 0, scrollHeight: 500, clientHeight: 100 }
  globalThis.document = document
  globalThis.window = { innerWidth: 100, innerHeight: 100 }
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  }
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id) }
  try {
    const source = target()
    const dropped = []
    makeScrollableDrag(source, {
      canDrag: () => true, targetAt: (x, y) => ({ x, y }), drop: (hit) => dropped.push(hit),
    })
    source.dispatch('pointerdown')
    source.dispatch('pointermove', { clientY: 95 })
    const frame = frames.get(1)
    frames.delete(1)
    frame()
    assert.ok(document.scrollingElement.scrollTop > 0)
    source.dispatch('pointerup', { clientY: 95 })
    assert.deepEqual(dropped, [{ x: 50, y: 95 }])
    assert.equal(frames.size, 0)
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.requestAnimationFrame = previousFrame
    globalThis.cancelAnimationFrame = previousCancelFrame
  }
})
