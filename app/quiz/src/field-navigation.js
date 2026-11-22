const editableFields = 'input[type="text"], input[type="number"], textarea'

export function removeEmptyRowOnBackspace(input, row, {
  removeSelector = '[data-remove-row]', focusSelector = 'input[type="text"]',
} = {}) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Backspace' || event.isComposing || event.altKey || event.ctrlKey
        || event.metaKey || input.value !== ''
        || [...row.querySelectorAll('input[type="text"], input[type="hidden"], textarea')]
          .some((field) => field.value !== '')) return
    const remove = row.querySelector(removeSelector)
    if (remove.disabled) return
    const neighbor = row.previousElementSibling?.querySelector(focusSelector)
      ?? row.nextElementSibling?.querySelector(focusSelector)
    event.preventDefault()
    remove.click()
    neighbor?.focus()
    neighbor?.setSelectionRange(neighbor.value.length, neighbor.value.length)
  })
}

function adjacentField(field, fields, direction) {
  const current = field.getBoundingClientRect()
  return fields.map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
    .filter(({ candidate, rect }) => candidate !== field && candidate.type !== 'number'
      && Math.min(current.bottom, rect.bottom) - Math.max(current.top, rect.top)
        >= Math.min(current.height, rect.height) / 2
      && (direction < 0 ? rect.right <= current.left + 1 : rect.left >= current.right - 1))
    .sort((a, b) => direction < 0 ? b.rect.right - a.rect.right : a.rect.left - b.rect.left)[0]?.candidate
}

function verticalField(field, fields, direction) {
  const current = field.getBoundingClientRect()
  const center = (current.left + current.right) / 2
  return fields.map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
    .filter(({ candidate, rect }) => candidate !== field
      && (direction < 0 ? rect.bottom <= current.top + 1 : rect.top >= current.bottom - 1))
    .sort((a, b) => {
      const distance = (rect) => direction < 0 ? current.top - rect.bottom : rect.top - current.bottom
      const horizontalGap = (rect) => Math.max(0, current.left - rect.right, rect.left - current.right)
      return distance(a.rect) - distance(b.rect)
        || horizontalGap(a.rect) - horizontalGap(b.rect)
        || Math.abs((a.rect.left + a.rect.right) / 2 - center)
          - Math.abs((b.rect.left + b.rect.right) / 2 - center)
    })[0]?.candidate
}

export function enableFieldNavigation(form, onEnd = () => {}) {
  form.addEventListener('keydown', (event) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey
        || (event.shiftKey && event.key !== 'Enter')) return
    const field = event.target
    if (!field.matches?.(editableFields) || !form.contains(field)) return

    const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (horizontal) {
      if (field.type === 'number' || field.selectionStart !== field.selectionEnd
          || (horizontal < 0 ? field.selectionStart !== 0 : field.selectionEnd !== field.value.length)) return
      const fields = [...form.querySelectorAll(editableFields)]
        .filter((item) => !item.disabled && item.getClientRects().length)
      const next = adjacentField(field, fields, horizontal)
      if (!next) return
      event.preventDefault()
      next.focus()
      const position = horizontal < 0 ? 0 : next.value.length
      next.setSelectionRange(position, position)
      return
    }

    const direction = event.key === 'ArrowUp' ? -1
      : event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey) ? 1 : 0
    if (!direction) return
    if (field.type === 'number' && event.key !== 'Enter') return
    if (field.tagName === 'TEXTAREA' && event.key !== 'Enter') {
      if (direction < 0 && field.selectionStart > 0) return
      if (direction > 0 && field.selectionEnd < field.value.length) return
    }

    const fields = [...form.querySelectorAll(editableFields)]
      .filter((item) => !item.disabled && item.getClientRects().length)
    if (!fields.includes(field)) return
    const next = verticalField(field, fields, direction)
    if (next) {
      event.preventDefault()
      next.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onEnd(field)
    }
  })
}
