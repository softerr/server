const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 10

export function updateMediaCardSelection(grid, selected) {
  for (const card of grid.querySelectorAll('[data-media-card-id]')) {
    const active = selected.has(Number(card.dataset.mediaCardId))
    card.classList.toggle('is-selected', active)
    card.setAttribute('aria-label', `${active ? 'Selected' : 'Select'} ${card.dataset.mediaCardName}`)
  }
}

export function bindMediaCardSelection(card, image, { grid, selected, anchor, visibleIds, busy, changed }) {
  card.dataset.mediaCardId = String(image.id)
  card.dataset.mediaCardName = image.name
  card.tabIndex = 0
  card.setAttribute('aria-description', 'Long press or press Space to select. Ctrl click to add or remove. Ctrl Shift click to select a range.')
  card.querySelector('img').draggable = false
  let timer = null
  let pointerStart = null
  let ignoreClickUntil = 0

  function update() {
    updateMediaCardSelection(grid, selected)
    changed()
  }

  function select(event) {
    if (busy()) return
    if (event.ctrlKey || event.metaKey) {
      const ids = visibleIds()
      const start = ids.indexOf(anchor.id)
      const end = ids.indexOf(image.id)
      if (event.shiftKey && start !== -1 && end !== -1) {
        for (const id of ids.slice(Math.min(start, end), Math.max(start, end) + 1)) selected.add(id)
      } else if (selected.has(image.id)) selected.delete(image.id)
      else selected.add(image.id)
      anchor.id = image.id
    } else {
      selected.clear()
      anchor.id = null
    }
    update()
  }

  function stopPress() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pointerStart = null
  }

  card.addEventListener('pointerdown', (event) => {
    if (busy() || event.button !== 0 || event.target.closest('button, a, input')) return
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }
    timer = setTimeout(() => {
      timer = null
      selected.add(image.id)
      anchor.id = image.id
      ignoreClickUntil = performance.now() + 700
      update()
    }, LONG_PRESS_MS)
  })
  card.addEventListener('pointermove', (event) => {
    if (pointerStart?.id !== event.pointerId) return
    if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > MOVE_TOLERANCE) stopPress()
  })
  card.addEventListener('pointerup', stopPress)
  card.addEventListener('pointercancel', stopPress)
  card.addEventListener('pointerleave', stopPress)
  card.addEventListener('contextmenu', (event) => { if (!busy()) event.preventDefault() })
  card.addEventListener('click', (event) => {
    if (event.target.closest('button, a, input') || busy()) return
    if (performance.now() < ignoreClickUntil) { ignoreClickUntil = 0; return }
    select(event)
  })
  card.addEventListener('keydown', (event) => {
    if (event.target !== card || busy()) return
    if (event.key === 'Escape') {
      selected.clear()
      anchor.id = null
      update()
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) select(event)
      else if (selected.size) { selected.clear(); anchor.id = null; update() }
      else { selected.add(image.id); anchor.id = image.id; update() }
    }
  })
}
