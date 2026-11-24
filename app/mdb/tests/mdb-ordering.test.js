import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrderingController } from '../src/ordering.js'

class Handle {
  constructor() {
    this.dataset = {}
    this.listeners = new Map()
    this.captured = null
  }

  addEventListener(type, listener) { this.listeners.set(type, listener) }
  removeEventListener(type) { this.listeners.delete(type) }
  setAttribute() {}
  focus() {}
  setPointerCapture(id) { this.captured = id }
  hasPointerCapture(id) { return this.captured === id }
  releasePointerCapture() { this.captured = null }
  dispatch(type, x, y) {
    this.listeners.get(type)({ pointerId: 1, isPrimary: true, button: 0,
      clientX: x, clientY: y, preventDefault() {} })
  }
}

function fixture(kind, ids) {
  let hit = null
  const requests = []
  const targets = ids.map((id) => ({
    dataset: {},
    id,
    closest() { return this },
    getBoundingClientRect() {
      const position = targets.indexOf(this)
      return kind === 'rows'
        ? { left: 40, right: 440, top: 50 + position * 40, bottom: 90 + position * 40, width: 400, height: 40 }
        : { left: 40 + position * 100, right: 140 + position * 100, top: 40, bottom: 140, width: 100, height: 100 }
    },
  }))
  const tableArea = {
    contains: (target) => targets.includes(target),
    getBoundingClientRect: () => ({ left: 0, right: 500, top: 0, bottom: 500 }),
    querySelector: (selector) => selector === 'thead th'
      ? { getBoundingClientRect: () => ({ bottom: 40 }) } : null,
  }
  const sceneDocument = { createElement: () => new Handle(), elementFromPoint: () => hit,
    addEventListener() {}, removeEventListener() {} }
  globalThis.document = sceneDocument
  const controller = createOrderingController({
    page: { isConnected: true }, tableArea, endpoint: '/table',
    requestJson: async (method, path, body) => {
      requests.push({ method, path, ids: [...body.ids] })
      return [{ ok: true }, {}]
    },
    responseError: () => '', setStatus() {}, status: {}, notice: { show() {} },
    pendingWrites: new Set(), refresh: async () => true,
    applyRowOrder: (oldIds, nextIds) => {
      oldIds.splice(0, oldIds.length, ...nextIds)
      targets.sort((left, right) => oldIds.indexOf(left.id) - oldIds.indexOf(right.id))
      targets.forEach((target, index) => { target.dataset.reorderIndex = String(index) })
      return true
    },
    rowsCannotReorder: () => false, getPageSize: () => null, getPageOffset: () => 0,
  })
  targets.forEach((target, index) => controller.dropTarget(target, kind, index))
  const handles = ids.map((id, index) => controller.dragHandle(kind, { id }, index, ids))
  return { targets, handles, requests, setHit: (target) => { hit = target },
    document: sceneDocument }
}

test('MDB mouse drops reorder rows and columns repeatedly, including above adjacent items', async () => {
  const previousDocument = globalThis.document
  const previousFrame = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  try {
    for (const kind of ['rows', 'columns']) {
      const ids = [1, 2, 3, 4]
      let scene = fixture(kind, ids)
      globalThis.document = scene.document
      for (const [movedId, targetId, pointerAfter, dropSide, expected] of [
        [4, 1, true, 'after', [1, 4, 2, 3]],
        [3, 2, false, 'before', [1, 4, 3, 2]],
        [2, 3, true, 'before', [1, 4, 2, 3]],
      ]) {
        const handle = scene.handles.find((item) => Number(item.dataset.orderId) === movedId)
        const source = scene.targets.find((item) => item.id === movedId)
        const target = scene.targets.find((item) => item.id === targetId)
        const sourceBounds = source.getBoundingClientRect()
        const targetBounds = target.getBoundingClientRect()
        const startX = sourceBounds.left + 20
        const startY = sourceBounds.top + 10
        const endX = kind === 'columns' ? targetBounds.left + (pointerAfter ? 70 : 20) : 100
        const endY = kind === 'rows' ? targetBounds.top + (pointerAfter ? 30 : 10) : 80
        assert.equal(handle.draggable, false)
        handle.dispatch('pointerdown', startX, startY)
        scene.setHit(target)
        handle.dispatch('pointermove', endX, endY)
        assert.equal(target.dataset.dropSide, dropSide)
        handle.dispatch('pointerup', endX, endY)
        await new Promise((resolve) => setImmediate(resolve))
        assert.deepEqual(scene.requests.at(-1),
          { method: 'PUT', path: `/table/${kind}/order`, ids: expected })
        if (kind === 'rows') assert.deepEqual(ids, expected)
        else {
          ids.splice(0, ids.length, ...expected)
          scene = fixture(kind, ids)
          globalThis.document = scene.document
        }
      }
      if (kind === 'rows') assert.equal(scene.requests.length, 3)
    }
  } finally {
    globalThis.document = previousDocument
    globalThis.requestAnimationFrame = previousFrame
    globalThis.cancelAnimationFrame = previousCancel
  }
})
