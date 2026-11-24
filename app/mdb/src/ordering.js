import { dragHandleIcon } from '@softerr/shared/icons.js'
import { bindPointerDrag, scrollNearPointer } from '@softerr/shared/pointer-drag.js'
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
  }

  function scrollWhileDragging() {
    scrollFrame = null
    const drag = pointerDrag
    if (!drag?.started) return
    if (!page.isConnected) { drag.cancel(); return }
    const bounds = tableArea.getBoundingClientRect()
    const axis = drag.kind === 'rows' ? 'y' : 'x'
    const start = axis === 'y'
      ? tableArea.querySelector('thead th')?.getBoundingClientRect().bottom ?? bounds.top
      : bounds.left
    scrollNearPointer(tableArea, bounds, drag.x, drag.y,
      { axis, start, edgeSize: 64, maxSpeed: 20 })
    updatePointerTarget()
    scrollFrame = requestAnimationFrame(scrollWhileDragging)
  }

  function dragHandle(kind, item, index, ids) {
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'mdb-drag-handle'
    handle.disabled = kind === 'rows' && rowsCannotReorder()
    handle.innerHTML = dragHandleIcon
    handle.dataset.orderKind = kind
    handle.dataset.orderId = String(item.id)
    const direction = kind === 'columns' ? 'left or right' : 'up or down'
    handle.setAttribute('aria-label', `Reorder ${kind === 'columns' ? 'column' : 'row'} ${index + 1}`)
    handle.title = `Drag to reorder, or press Alt + Arrow ${direction}`
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
    const cancelDrag = bindPointerDrag(handle, {
      canStart: () => !handle.disabled && !pointerDrag && !reordering
        && (kind !== 'rows' || !rowsCannotReorder()),
      preventDefaultOnDown: true,
      onDown(drag) {
        Object.assign(drag, { kind, id: item.id, ids, handle, cancel: cancelDrag })
        pointerDrag = drag
        handle.focus({ preventScroll: true })
      },
      onStart: () => { handle.dataset.dragging = '' },
      onMove() {
        updatePointerTarget()
        if (scrollFrame === null) scrollFrame = requestAnimationFrame(scrollWhileDragging)
      },
      onFinish(drag, shouldDrop) {
        if (shouldDrop) updatePointerTarget()
        const target = shouldDrop && markedTarget
        const targetIndex = target && Number(target.dataset.reorderIndex)
        const after = target?.dataset.dropSide === 'after'
        stopPointer(drag)
        if (target) reorderFromDrop(kind, ids, item.id, targetIndex, after)
      },
    })
    return handle
  }

  function dropTarget(element, kind, index) {
    element.dataset.reorderKind = kind
    element.dataset.reorderIndex = String(index)
  }

  return { dragHandle, dropTarget }
}
