const cellControl = '.mdb-cell-control, .mdb-multi-button, .mdb-image-button'
const navigationSource = `${cellControl}, .mdb-date-button`

function focusableControl(cell) {
  return [...(cell?.querySelectorAll(cellControl) ?? [])]
    .find((control) => !control.disabled && !control.hidden)
}

function nextCell(cell, direction) {
  for (let candidate = direction < 0 ? cell.previousElementSibling : cell.nextElementSibling;
    candidate; candidate = direction < 0 ? candidate.previousElementSibling : candidate.nextElementSibling) {
    const control = focusableControl(candidate)
    if (control) return control
  }
  return null
}

function nextRowCell(row, columnIndex, direction) {
  for (let candidate = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    candidate; candidate = direction < 0 ? candidate.previousElementSibling : candidate.nextElementSibling) {
    if (!candidate.matches('.mdb-data-row')) continue
    const control = focusableControl(candidate.cells[columnIndex])
    if (control) return control
  }
  return null
}

export function enableCellNavigation(table) {
  table.addEventListener('keydown', (event) => {
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'Enter' ? 1 : 0
    if (!direction || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const control = event.target
    if (!control.matches?.(navigationSource) || !table.contains(control)) return
    if (event.key === 'Enter' && !control.matches('.mdb-cell-control')) return
    const cell = control.closest('td')
    const row = cell?.parentElement
    if (!row?.matches('.mdb-data-row')) return

    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    if (horizontal && control.matches('input[type="text"]') && !control.readOnly
      && control.selectionStart !== null) {
      if (control.selectionStart !== control.selectionEnd
        || (direction < 0 ? control.selectionStart > 0
          : control.selectionEnd < control.value.length)) return
    }

    const target = horizontal ? nextCell(cell, direction)
      : nextRowCell(row, cell.cellIndex, direction)
    if (!target) return
    event.preventDefault()
    target.focus()
  })
}
