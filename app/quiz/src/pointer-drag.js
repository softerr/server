// Pointer based dragging leaves wheel events available to the page and preview dialog.
import { bindPointerDrag, scrollNearPointer } from '@softerr/shared/pointer-drag.js'

export function makeScrollableDrag(source, { canDrag, targetAt, drop, ignoreStart = () => false }) {
  let active = null
  let suppressClick = false

  function scrollNearEdge() {
    if (!active?.started) return
    const { scroller, dialog, pointerX, pointerY } = active
    const bounds = dialog?.getBoundingClientRect() || {
      left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight,
    }
    scrollNearPointer(scroller, bounds, pointerX, pointerY)
    active.frame = requestAnimationFrame(scrollNearEdge)
  }

  source.addEventListener('click', (event) => {
    if (!suppressClick) return
    event.preventDefault()
    event.stopImmediatePropagation()
    suppressClick = false
  }, true)

  bindPointerDrag(source, {
    canStart: (event) => !active && canDrag() && !ignoreStart(event.target),
    onDown(drag) {
      const rect = source.getBoundingClientRect()
      const dialog = source.closest('dialog[open]')
      Object.assign(drag, {
        offsetX: drag.x - rect.left, offsetY: drag.y - rect.top,
        width: rect.width, dialog, scroller: dialog || document.scrollingElement,
        pointerX: drag.x, pointerY: drag.y, frame: null, ghost: null,
      })
      active = drag
    },
    onStart(drag) {
      const ghost = source.cloneNode(true)
      ghost.classList.add('play-drag-ghost')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.inert = true
      ghost.style.width = `${drag.width}px`
      ;(source.closest('.play-drag-activity') || source.closest('dialog[open]') || document.body).append(ghost)
      drag.ghost = ghost
      source.classList.add('is-pointer-dragging')
      drag.frame = requestAnimationFrame(scrollNearEdge)
    },
    onMove(drag) {
      drag.pointerX = drag.x
      drag.pointerY = drag.y
      drag.ghost.style.left = `${drag.x - drag.offsetX}px`
      drag.ghost.style.top = `${drag.y - drag.offsetY}px`
    },
    onFinish(drag, shouldDrop) {
      const target = shouldDrop ? targetAt(drag.x, drag.y) : null
      if (drag.frame) cancelAnimationFrame(drag.frame)
      active = null
      drag.ghost?.remove()
      source.classList.remove('is-pointer-dragging')
      if (drag.started) {
        suppressClick = true
        setTimeout(() => { suppressClick = false }, 0)
        if (target) drop(target)
      }
    },
  })
}
