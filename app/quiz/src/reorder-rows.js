import { dragHandleIcon } from '@softerr/shared/icons.js'
import { bindPointerDrag, scrollNearPointer } from '@softerr/shared/pointer-drag.js'

const states = new WeakMap()

function stateFor(rows) {
  if (!states.has(rows)) states.set(rows, { drag: null, target: null, frame: null })
  return states.get(rows)
}

function clearTarget(state) {
  if (state.target) delete state.target.dataset.dropSide
  state.target = null
}

function markTarget(state, row, after) {
  const side = effectiveSide(state.drag?.source, row, after)
  if (side === null) { clearTarget(state); return }
  if (state.target !== row) clearTarget(state)
  state.target = row
  row.dataset.dropSide = side ? 'after' : 'before'
}

function directTarget(rows, element) {
  let target = element
  while (target && target.parentElement !== rows) target = target.parentElement
  return target?.dataset?.reorderTarget === '' ? target : null
}

function targetAt(rows, x, y) {
  const target = directTarget(rows, document.elementFromPoint(x, y))
  if (target) return target
  const items = [...rows.children]
  if (!items.length) return null
  const bounds = items.map((row) => row.getBoundingClientRect())
  const left = Math.min(...bounds.map((rect) => rect.left))
  const right = Math.max(...bounds.map((rect) => rect.right))
  const placeholder = rows.nextElementSibling?.matches?.(
    '.question-row-placeholder, .question-pair-placeholder, .question-category-placeholder, .diagram-editor-row.is-placeholder',
  ) ? rows.nextElementSibling : null
  const bottom = Math.max(bounds.at(-1).bottom + 48,
    placeholder?.getBoundingClientRect().bottom ?? -Infinity)
  if (x < left || x > right || y < bounds[0].top - 48
    || y > bottom) return null
  return items.find((row, index) => y <= bounds[index].bottom) ?? items.at(-1)
}

function afterMiddle(row, y) {
  const bounds = row.getBoundingClientRect()
  return y >= bounds.top + bounds.height / 2
}

function effectiveSide(source, target, after) {
  if (!source || !target || source === target) return null
  if (source.nextElementSibling === target) return true
  if (source.previousElementSibling === target) return false
  return after
}

function changesOrder(source, target, after) {
  return source && target && source !== target
    && (after ? source.previousElementSibling !== target : source.nextElementSibling !== target)
}

function reorder(rows, source, target, after, onUpdate, handle) {
  if (!source || !target || source.parentElement !== rows
    || target.parentElement !== rows || !changesOrder(source, target, after)) return
  const previous = [...rows.children]
  rows.insertBefore(source, after ? target.nextElementSibling : target)
  if (previous.every((row, index) => rows.children[index] === row)) return
  onUpdate()
  handle.focus({ preventScroll: true })
}

function stopPointer(state, drag) {
  if (state.drag !== drag) return
  if (state.frame !== null) cancelAnimationFrame(state.frame)
  state.frame = null
  state.drag = null
  clearTarget(state)
  delete drag.handle.dataset.dragging
}

function scrollNearEdge(state, rows) {
  state.frame = null
  const drag = state.drag
  if (!drag?.started) return
  if (!rows.isConnected) { drag.cancel(); return }
  const dialog = drag.handle.closest('dialog[open]')
  const scroller = dialog || document.scrollingElement
  const bounds = dialog?.getBoundingClientRect() || {
    left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight,
  }
  scrollNearPointer(scroller, bounds, drag.x, drag.y)
  const target = targetAt(rows, drag.x, drag.y)
  if (target) markTarget(state, target, afterMiddle(target, drag.y))
  else clearTarget(state)
  state.frame = requestAnimationFrame(() => scrollNearEdge(state, rows))
}

export function createRowReorderHandle(row, rows, onUpdate) {
  const state = stateFor(rows)
  const handle = document.createElement('button')
  handle.type = 'button'
  handle.className = 'question-drag-handle'
  handle.dataset.reorderHandle = ''
  handle.innerHTML = dragHandleIcon
  handle.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown')

  row.dataset.reorderTarget = ''
  handle.addEventListener('keydown', (event) => {
    if (!event.altKey || handle.disabled) return
    const target = event.key === 'ArrowUp' ? row.previousElementSibling
      : event.key === 'ArrowDown' ? row.nextElementSibling : null
    if (!target) return
    event.preventDefault()
    reorder(rows, row, target, event.key === 'ArrowDown', onUpdate, handle)
  })
  const cancelDrag = bindPointerDrag(handle, {
    canStart: () => !handle.disabled && !state.drag,
    preventDefaultOnDown: true,
    onDown(drag) {
      Object.assign(drag, { source: row, handle, onUpdate, cancel: cancelDrag })
      state.drag = drag
      handle.focus({ preventScroll: true })
    },
    onStart: () => { handle.dataset.dragging = '' },
    onMove(drag) {
      const target = targetAt(rows, drag.x, drag.y)
      if (target) markTarget(state, target, afterMiddle(target, drag.y))
      else clearTarget(state)
      if (state.frame === null) state.frame = requestAnimationFrame(() => scrollNearEdge(state, rows))
    },
    onFinish(drag, shouldDrop) {
      const hit = shouldDrop && targetAt(rows, drag.x, drag.y)
      const target = hit && (state.target || hit)
      const after = target && (state.target === target
        ? target.dataset.dropSide === 'after'
        : effectiveSide(drag.source, target, afterMiddle(target, drag.y)))
      stopPointer(state, drag)
      if (target) reorder(rows, drag.source, target, after, drag.onUpdate, handle)
    },
  })
  return handle
}
