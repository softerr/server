const dragIcon = `<svg viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
  <circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/>
  <circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/>
  <circle cx="5" cy="16" r="1.5"/><circle cx="11" cy="16" r="1.5"/>
</svg>`
export function createOrderingController({ page, tableArea, endpoint, requestJson, responseError,
  setStatus, status, notice, pendingWrites, refresh, applyRowOrder, rowsCannotReorder,
  getPageSize, getPageOffset }) {
  let dragState = null
  let touchDrag = null
  let touchScrollFrame = null
  let reordering = false

  function clearDropMarkers() {
    tableArea.querySelectorAll('[data-drop-side]').forEach((item) => { delete item.dataset.dropSide })
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

  function markDropTarget(element, kind, x, y) {
    clearDropMarkers()
    element.dataset.dropSide = targetSide(element, kind, x, y) ? 'after' : 'before'
  }

  function touchTarget(kind, x, y) {
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

  function updateTouchTarget() {
    const { kind, x, y } = touchDrag
    const target = touchTarget(kind, x, y)
    if (target) markDropTarget(target, kind, x, y)
    else clearDropMarkers()
  }

  function stopTouchScroll() {
    if (touchScrollFrame !== null) cancelAnimationFrame(touchScrollFrame)
    touchScrollFrame = null
  }

  function scrollWhileDragging() {
    touchScrollFrame = null
    if (!touchDrag || touchDrag.kind !== 'rows' || !page.isConnected) return
    const bounds = tableArea.getBoundingClientRect()
    const { x, y } = touchDrag
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return
    const top = tableArea.querySelector('thead th')?.getBoundingClientRect().bottom ?? bounds.top
    const topDistance = y - top
    const bottomDistance = bounds.bottom - y
    const distance = Math.min(topDistance, bottomDistance)
    if (distance >= 64) return
    const direction = topDistance < bottomDistance ? -1 : 1
    const speed = Math.ceil(2 + 18 * Math.min(1, (64 - distance) / 64))
    const previous = tableArea.scrollTop
    tableArea.scrollTop += direction * speed
    if (tableArea.scrollTop === previous) return
    updateTouchTarget()
    touchScrollFrame = requestAnimationFrame(scrollWhileDragging)
  }

  function dragHandle(kind, item, index, ids) {
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'mdb-drag-handle'
    handle.disabled = kind === 'rows' && rowsCannotReorder()
    handle.draggable = !handle.disabled
    handle.innerHTML = dragIcon
    handle.dataset.orderKind = kind
    handle.dataset.orderId = String(item.id)
    const direction = kind === 'columns' ? 'left or right' : 'up or down'
    handle.setAttribute('aria-label', `Reorder ${kind === 'columns' ? 'column' : 'row'} ${index + 1}`)
    handle.title = `Drag to reorder, or press Alt + Arrow ${direction}`
    handle.addEventListener('dragstart', (event) => {
      if (reordering || touchDrag || (kind === 'rows' && rowsCannotReorder())) { event.preventDefault(); return }
      dragState = { kind, id: item.id }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(item.id))
    })
    handle.addEventListener('dragend', () => { dragState = null; clearDropMarkers() })
    handle.addEventListener('keydown', (event) => {
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
      if (event.pointerType === 'mouse' || touchDrag || reordering
        || (kind === 'rows' && rowsCannotReorder())) return
      event.preventDefault()
      handle.setPointerCapture(event.pointerId)
      touchDrag = { kind, id: item.id, ids, pointerId: event.pointerId, x: null, y: null }
    })
    handle.addEventListener('pointermove', (event) => {
      if (touchDrag?.pointerId !== event.pointerId) return
      touchDrag.x = event.clientX
      touchDrag.y = event.clientY
      updateTouchTarget()
      if (kind === 'rows' && touchScrollFrame === null) {
        touchScrollFrame = requestAnimationFrame(scrollWhileDragging)
      }
    })
    handle.addEventListener('pointerup', (event) => {
      if (touchDrag?.pointerId !== event.pointerId) return
      stopTouchScroll()
      const target = touchTarget(kind, event.clientX, event.clientY)
      const after = target && targetSide(target, kind, event.clientX, event.clientY)
      touchDrag = null
      clearDropMarkers()
      if (target) reorderFromDrop(kind, ids, item.id, Number(target.dataset.reorderIndex), after)
    })
    handle.addEventListener('pointercancel', (event) => {
      if (touchDrag?.pointerId !== event.pointerId) return
      stopTouchScroll()
      touchDrag = null
      clearDropMarkers()
    })
    return handle
  }

  function dropTarget(element, kind, index, ids) {
    element.dataset.reorderKind = kind
    element.dataset.reorderIndex = String(index)
    element.addEventListener('dragover', (event) => {
      if (dragState?.kind !== kind || reordering || (kind === 'rows' && rowsCannotReorder())) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      markDropTarget(element, kind, event.clientX, event.clientY)
    })
    element.addEventListener('drop', (event) => {
      if (dragState?.kind !== kind || reordering || (kind === 'rows' && rowsCannotReorder())) return
      event.preventDefault()
      const movedId = dragState.id
      const after = element.dataset.dropSide === 'after'
      dragState = null
      clearDropMarkers()
      reorderFromDrop(kind, ids, movedId, Number(element.dataset.reorderIndex), after)
    })
  }

  return { dragHandle, dropTarget }
}
