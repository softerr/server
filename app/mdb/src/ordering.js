const dragIcon = `<svg viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
  <circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/>
  <circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/>
  <circle cx="5" cy="16" r="1.5"/><circle cx="11" cy="16" r="1.5"/>
</svg>`
export function createOrderingController({ page, tableArea, endpoint, requestJson, responseError,
  setStatus, status, notice, pendingWrites, refresh, rowsCannotReorder, getPageSize, getPageOffset }) {
  let dragState = null
  let touchDrag = null
  let reordering = false

  function clearDropMarkers() {
    tableArea.querySelectorAll('[data-drop-side]').forEach((item) => { delete item.dataset.dropSide })
  }

  async function saveOrder(kind, oldIds, nextIds, focusId = null) {
    if (reordering || (kind === 'rows' && rowsCannotReorder())
      || oldIds.every((id, index) => id === nextIds[index])) return
    reordering = true
    setStatus(status, `Saving ${kind} order…`)
    try {
      await Promise.all([...pendingWrites])
      const [response, payload] = await requestJson('PUT', `${endpoint}/${kind}/order`,
        kind === 'rows' && getPageSize() !== null
          ? { ids: nextIds, start_position: getPageOffset() + 1 } : { ids: nextIds })
      if (!page.isConnected) return
      if (!response.ok) throw new Error(responseError(response, payload))
      if (await refresh()) {
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
    saveOrder(kind, ids, nextIds)
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
    const target = document.elementFromPoint(x, y)?.closest('[data-reorder-kind]')
    return target && tableArea.contains(target) && target.dataset.reorderKind === kind ? target : null
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
      if (event.pointerType === 'mouse' || reordering || (kind === 'rows' && rowsCannotReorder())) return
      event.preventDefault()
      handle.setPointerCapture(event.pointerId)
      touchDrag = { kind, id: item.id, ids, pointerId: event.pointerId }
    })
    handle.addEventListener('pointermove', (event) => {
      if (touchDrag?.pointerId !== event.pointerId) return
      const target = touchTarget(kind, event.clientX, event.clientY)
      if (target) markDropTarget(target, kind, event.clientX, event.clientY)
      else clearDropMarkers()
    })
    handle.addEventListener('pointerup', (event) => {
      if (touchDrag?.pointerId !== event.pointerId) return
      const target = touchTarget(kind, event.clientX, event.clientY)
      const after = target?.dataset.dropSide === 'after'
      touchDrag = null
      clearDropMarkers()
      if (target) reorderFromDrop(kind, ids, item.id, Number(target.dataset.reorderIndex), after)
    })
    handle.addEventListener('pointercancel', () => { touchDrag = null; clearDropMarkers() })
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
