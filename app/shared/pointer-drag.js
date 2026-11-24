export function scrollNearPointer(scroller, bounds, x, y, {
  axis = 'y', start = axis === 'y' ? bounds.top : bounds.left,
  end = axis === 'y' ? bounds.bottom : bounds.right,
  edgeSize = 72, maxSpeed = 18,
} = {}) {
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom
    || end <= start) return
  const edge = Math.min(edgeSize, (end - start) / 4)
  const position = axis === 'y' ? y : x
  let speed = 0
  if (position < start + edge) speed = -Math.ceil(maxSpeed * (start + edge - position) / edge)
  else if (position > end - edge) speed = Math.ceil(maxSpeed * (position - end + edge) / edge)
  if (!speed) return
  if (axis === 'y' && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop += speed
  else if (axis === 'x' && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft += speed
}

export function bindPointerDrag(source, {
  canStart, onDown, onStart, onMove, onFinish, preventDefaultOnDown = false,
}) {
  let active = null

  function finish(event, shouldDrop) {
    const drag = active
    if (!drag || event.pointerId !== drag.pointerId) return
    active = null
    document.removeEventListener('keydown', onKeyDown, true)
    if (source.hasPointerCapture(drag.pointerId)) source.releasePointerCapture(drag.pointerId)
    onFinish(drag, shouldDrop && drag.started, event)
  }

  function cancel() {
    if (active) finish({ pointerId: active.pointerId }, false)
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !active) return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }

  source.draggable = false
  source.addEventListener('dragstart', (event) => event.preventDefault())
  source.addEventListener('pointerdown', (event) => {
    if (active || !event.isPrimary || event.button !== 0 || !canStart(event)) return
    if (preventDefaultOnDown) event.preventDefault()
    const drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, started: false }
    active = drag
    onDown(drag, event)
    source.setPointerCapture(event.pointerId)
    document.addEventListener('keydown', onKeyDown, true)
  })
  source.addEventListener('pointermove', (event) => {
    const drag = active
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (!drag.started) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return
      drag.started = true
      onStart(drag, event)
    }
    event.preventDefault()
    onMove(drag, event)
  })
  source.addEventListener('pointerup', (event) => {
    if (active?.pointerId !== event.pointerId) return
    active.x = event.clientX
    active.y = event.clientY
    finish(event, true)
  })
  source.addEventListener('pointercancel', (event) => finish(event, false))
  source.addEventListener('lostpointercapture', (event) => finish(event, false))
  return cancel
}
