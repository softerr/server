const dragIcon = `<svg viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
  <circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/>
  <circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/>
  <circle cx="5" cy="16" r="1.5"/><circle cx="11" cy="16" r="1.5"/>
</svg>`
export function createOrderingController({ page, tableArea, endpoint, requestJson, responseError,
  setStatus, status, notice, pendingWrites, refresh, applyRowOrder, rowsCannotReorder,
  getPageSize, getPageOffset }) {
  let pointerDrag = null
  let scrollFrame = null
  let markedTarget = null
  let reordering = false

  function clearDropMarkers() {
    if (markedTarget) delete markedTarget.dataset.dropSide
    markedTarget = null
  }

  async function saveOrder(kind, oldIds, nextIds, focusId = null, movedId = focusId) {
    if (reordering || (kind === 'rows' && rowsCannotReorder())
      || oldIds.every((id, index) => id === nextIds[index])) return
    const pageSize = getPageSize()
    const pageOffset = getPageOffset()
    reordering = true
    setStatus(status, `Saving ${kind} order…`)
    try {
      await Promise.all([...pendingWrites])
      const [response, payload] = await requestJson('PUT', `${endpoint}/${kind}/order`,
        kind === 'rows' && pageSize !== null
          ? { ids: nextIds, start_position: pageOffset + 1 } : { ids: nextIds })
      if (!page.isConnected) return
      if (!response.ok) throw new Error(responseError(response, payload))
      const updated = kind === 'rows'
        && applyRowOrder(oldIds, nextIds, movedId, pageOffset, pageSize)
      if (updated || await refresh({ preserveScroll: true })) {
        setStatus(status, '')
        if (focusId !== null) {
          tableArea.querySelector(`.mdb-drag-handle[data-order-kind="${kind}"][data-order-id="${focusId}"]`)?.focus()
        }
        notice.show(`${kind === 'columns' ? 'Columns' : 'Rows'} reordered.`)
      }
    } catch (error) {
      if (page.isConnected) {
        setStatus(status, '')
        notice.show(error.message || `Could not reorder ${kind}.`, 'error')
      }
    } finally {
      reordering = false
    }
  }

  function reorderFromDrop(kind, ids, movedId, targetIndex, after) {
    const nextIds = ids.filter((id) => id !== movedId)
    const targetId = ids[targetIndex]
    const index = nextIds.indexOf(targetId)
    if (index < 0) return
    nextIds.splice(index + (after ? 1 : 0), 0, movedId)
    saveOrder(kind, ids, nextIds, null, movedId)
  }

  function targetSide(element, kind, x, y) {
    const bounds = element.getBoundingClientRect()
    return kind === 'columns'
      ? x >= bounds.left + bounds.width / 2
      : y >= bounds.top + bounds.height / 2
  }

  function markDropTarget(element, drag) {
    const targetIndex = Number(element.dataset.reorderIndex)
    const sourceIndex = drag.ids.indexOf(drag.id)
    if (targetIndex === sourceIndex || sourceIndex < 0) { clearDropMarkers(); return }
    let after = targetSide(element, drag.kind, drag.x, drag.y)
    if (targetIndex === sourceIndex + 1) after = true
    if (targetIndex === sourceIndex - 1) after = false
    if (markedTarget !== element) clearDropMarkers()
    markedTarget = element
    element.dataset.dropSide = after ? 'after' : 'before'
  }

  function targetAt(kind, x, y) {
    if (kind === 'rows') {
      const bounds = tableArea.getBoundingClientRect()
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null
      const headerBottom = tableArea.querySelector('thead th')?.getBoundingClientRect().bottom ?? bounds.top
      y = Math.max(y, Math.min(bounds.bottom - 1, headerBottom + 1))
    }
    let target = document.elementFromPoint(x, y)?.closest('[data-reorder-kind]')
    if (kind === 'rows' && target?.dataset.reorderKind !== 'rows') {
      const lastRow = tableArea.querySelector('.mdb-row-placeholder')?.previousElementSibling
      if (lastRow?.dataset.reorderKind === 'rows' && y >= lastRow.getBoundingClientRect().bottom) {
        target = lastRow
      }
    }
    return target && tableArea.contains(target) && target.dataset.reorderKind === kind ? target : null
  }

  function updatePointerTarget() {
    const drag = pointerDrag
    const target = targetAt(drag.kind, drag.x, drag.y)
    if (target) markDropTarget(target, drag)
    else clearDropMarkers()
  }

  function stopPointer(drag) {
    if (pointerDrag !== drag) return
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
    scrollFrame = null
    pointerDrag = null
    clearDropMarkers()
    delete drag.handle.dataset.dragging
    drag.handle.removeEventListener('lostpointercapture', drag.onLost)
    if (drag.handle.hasPointerCapture(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId)
    }
  }

  function scrollWhileDragging() {
    scrollFrame = null
    const drag = pointerDrag
    if (!drag?.started) return
    if (!page.isConnected) { stopPointer(drag); return }
    const bounds = tableArea.getBoundingClientRect()
    if (drag.x >= bounds.left && drag.x <= bounds.right
      && drag.y >= bounds.top && drag.y <= bounds.bottom) {
      const start = drag.kind === 'rows'
        ? tableArea.querySelector('thead th')?.getBoundingClientRect().bottom ?? bounds.top
        : bounds.left
      const end = drag.kind === 'rows' ? bounds.bottom : bounds.right
      const position = drag.kind === 'rows' ? drag.y : drag.x
      const edge = Math.min(64, (end - start) / 4)
      let speed = 0
      if (position < start + edge) speed = -Math.ceil(20 * (start + edge - position) / edge)
      else if (position > end - edge) speed = Math.ceil(20 * (position - end + edge) / edge)
      if (speed && drag.kind === 'rows' && tableArea.scrollHeight > tableArea.clientHeight) {
        tableArea.scrollTop += speed
      } else if (speed && drag.kind === 'columns' && tableArea.scrollWidth > tableArea.clientWidth) {
        tableArea.scrollLeft += speed
      }
    }
    updatePointerTarget()
    scrollFrame = requestAnimationFrame(scrollWhileDragging)
  }

  function dragHandle(kind, item, index, ids) {
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'mdb-drag-handle'
    handle.disabled = kind === 'rows' && rowsCannotReorder()
    handle.draggable = false
    handle.innerHTML = dragIcon
    handle.dataset.orderKind = kind
    handle.dataset.orderId = String(item.id)
    const direction = kind === 'columns' ? 'left or right' : 'up or down'
    handle.setAttribute('aria-label', `Reorder ${kind === 'columns' ? 'column' : 'row'} ${index + 1}`)
    handle.title = `Drag to reorder, or press Alt + Arrow ${direction}`
    handle.addEventListener('dragstart', (event) => event.preventDefault())
    handle.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && pointerDrag?.handle === handle) {
        event.preventDefault()
        stopPointer(pointerDrag)
        return
      }
      const currentIndex = ids.indexOf(item.id)
      const step = kind === 'columns'
        ? (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)
        : (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
      if (!event.altKey || !step || currentIndex < 0
        || currentIndex + step < 0 || currentIndex + step >= ids.length) return
      event.preventDefault()
      const nextIds = [...ids]
      ;[nextIds[currentIndex], nextIds[currentIndex + step]]
        = [nextIds[currentIndex + step], nextIds[currentIndex]]
      saveOrder(kind, ids, nextIds, item.id)
    })
    handle.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0 || handle.disabled || pointerDrag || reordering
        || (kind === 'rows' && rowsCannotReorder())) return
      event.preventDefault()
      const drag = { kind, id: item.id, ids, handle, pointerId: event.pointerId,
        startX: event.clientX, startY: event.clientY,
        x: event.clientX, y: event.clientY, started: false }
      drag.onLost = (lost) => {
        if (lost.pointerId === drag.pointerId) stopPointer(drag)
      }
      pointerDrag = drag
      handle.addEventListener('lostpointercapture', drag.onLost)
      handle.setPointerCapture(event.pointerId)
      handle.focus({ preventScroll: true })
    })
    handle.addEventListener('pointermove', (event) => {
      const drag = pointerDrag
      if (drag?.handle !== handle || drag.pointerId !== event.pointerId) return
      drag.x = event.clientX
      drag.y = event.clientY
      if (!drag.started) {
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return
        drag.started = true
        handle.dataset.dragging = ''
      }
      event.preventDefault()
      updatePointerTarget()
      if (scrollFrame === null) scrollFrame = requestAnimationFrame(scrollWhileDragging)
    })
    handle.addEventListener('pointerup', (event) => {
      const drag = pointerDrag
      if (drag?.handle !== handle || drag.pointerId !== event.pointerId) return
      drag.x = event.clientX
      drag.y = event.clientY
      if (drag.started) updatePointerTarget()
      const target = drag.started && markedTarget
      const targetIndex = target && Number(target.dataset.reorderIndex)
      const after = target?.dataset.dropSide === 'after'
      stopPointer(drag)
      if (target) reorderFromDrop(kind, ids, item.id, targetIndex, after)
    })
    handle.addEventListener('pointercancel', (event) => {
      if (pointerDrag?.handle === handle && pointerDrag.pointerId === event.pointerId) {
        stopPointer(pointerDrag)
      }
    })
    return handle
  }

  function dropTarget(element, kind, index) {
    element.dataset.reorderKind = kind
    element.dataset.reorderIndex = String(index)
  }

  return { dragHandle, dropTarget }
}
