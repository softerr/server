// Pointer based dragging leaves wheel events available to the page and preview dialog.
export function makeScrollableDrag(source, { canDrag, targetAt, drop, ignoreStart = () => false }) {
  let active = null
  let suppressClick = false

  function scrollNearEdge() {
    if (!active?.dragging) return
    const { scroller, dialog, pointerX, pointerY } = active
    const bounds = dialog?.getBoundingClientRect() || {
      left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight,
    }
    if (scroller.scrollHeight > scroller.clientHeight
      && pointerX >= bounds.left && pointerX <= bounds.right
      && pointerY >= bounds.top && pointerY <= bounds.bottom) {
      const edge = Math.min(72, (bounds.bottom - bounds.top) / 4)
      let speed = 0
      if (pointerY < bounds.top + edge) speed = -Math.ceil(18 * (bounds.top + edge - pointerY) / edge)
      else if (pointerY > bounds.bottom - edge) speed = Math.ceil(18 * (pointerY - bounds.bottom + edge) / edge)
      scroller.scrollTop += speed
    }
    active.frame = requestAnimationFrame(scrollNearEdge)
  }

  source.addEventListener('dragstart', (event) => event.preventDefault())
  source.addEventListener('click', (event) => {
    if (!suppressClick) return
    event.preventDefault()
    event.stopImmediatePropagation()
    suppressClick = false
  }, true)

  function finish(event, shouldDrop) {
    if (!active || event.pointerId !== active.pointerId) return
    const { ghost, dragging, frame } = active
    const target = dragging && shouldDrop ? targetAt(event.clientX, event.clientY) : null
    if (frame) cancelAnimationFrame(frame)
    active = null
    ghost?.remove()
    source.classList.remove('is-pointer-dragging')
    document.removeEventListener('keydown', onKeyDown, true)
    if (source.hasPointerCapture(event.pointerId)) source.releasePointerCapture(event.pointerId)
    if (dragging) {
      suppressClick = true
      setTimeout(() => { suppressClick = false }, 0)
      if (target) drop(target)
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !active) return
    event.preventDefault()
    event.stopPropagation()
    finish({ pointerId: active.pointerId }, false)
  }

  source.addEventListener('pointerdown', (event) => {
    if (active || !event.isPrimary || event.button !== 0 || !canDrag() || ignoreStart(event.target)) return
    const rect = source.getBoundingClientRect()
    const dialog = source.closest('dialog[open]')
    active = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      dialog,
      scroller: dialog || document.scrollingElement,
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame: null,
      ghost: null,
      dragging: false,
    }
    source.setPointerCapture(event.pointerId)
    document.addEventListener('keydown', onKeyDown, true)
  })

  source.addEventListener('pointermove', (event) => {
    if (!active || event.pointerId !== active.pointerId) return
    if (!active.dragging) {
      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 5) return
      active.dragging = true
      const ghost = source.cloneNode(true)
      ghost.classList.add('play-drag-ghost')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.inert = true
      ghost.style.width = `${active.width}px`
      ;(source.closest('.play-drag-activity') || source.closest('dialog[open]') || document.body).append(ghost)
      active.ghost = ghost
      source.classList.add('is-pointer-dragging')
      active.frame = requestAnimationFrame(scrollNearEdge)
    }
    active.pointerX = event.clientX
    active.pointerY = event.clientY
    active.ghost.style.left = `${event.clientX - active.offsetX}px`
    active.ghost.style.top = `${event.clientY - active.offsetY}px`
    event.preventDefault()
  })

  source.addEventListener('pointerup', (event) => finish(event, true))
  source.addEventListener('pointercancel', (event) => finish(event, false))
  source.addEventListener('lostpointercapture', (event) => finish(event, false))
}
