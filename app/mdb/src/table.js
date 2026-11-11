import { editIcon, deleteIcon, imageIcon, missingMediaIcon } from '../../shared/icons.js'
import { mediaThumbnailUrl } from '../../shared/media-client.js'
import { showMissingImageWhenUnavailable } from '../../shared/missing-image.js'
import { parsePastedDate } from './date-parse.js'

const calendarIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
  <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>
</svg>`
const sortIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
  <path d="m6 8 4-4 4 4M6 12l4 4 4-4"/>
</svg>`
const sortUpIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
  <path d="M10 16V4m-5 5 5-5 5 5"/>
</svg>`
const sortDownIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
  <path d="M10 4v12m-5-5 5 5 5-5"/>
</svg>`
export function createTableController({ page, endpoint, requestJson, responseError, notice,
  pendingWrites, tableArea, title, saveCell, openImageDialog, addChoiceControl,
  dragHandle, dropTarget, openColumnDialog, openDeleteDialog, createRow, refresh,
  getActiveSort, setActiveSort, getSearchQuery, getAllRowsLoading, setPageOffset,
  resetRelationCaches }) {
  function addCellControl(td, row, column, related) {
    const label = `${column.name}, row ${row.position}`
    const value = row.values?.[column.id]
    if (column.type === 'image') {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mdb-image-button'
      let savedValue = value ?? null
      const render = () => {
        button.replaceChildren()
        if (savedValue === null) button.innerHTML = imageIcon
        else {
          const preview = document.createElement('img')
          preview.className = 'mdb-image-preview'
          preview.alt = ''
          preview.loading = 'lazy'
          showMissingImageWhenUnavailable(preview,
            { className: 'mdb-image-missing', icon: missingMediaIcon })
          preview.src = mediaThumbnailUrl(savedValue)
          button.append(preview)
        }
        button.setAttribute('aria-label', `${savedValue === null ? 'Choose' : 'Change'} ${label} image`)
      }
      button.addEventListener('click', () => openImageDialog({ button, row, column,
        get value() { return savedValue }, set value(next) { savedValue = next; render() } }))
      render()
      td.append(button)
      return
    }
    if (column.type === 'date') {
      const wrapper = document.createElement('div')
      wrapper.className = 'mdb-date-cell'
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'mdb-cell-control'
      input.autocomplete = 'off'
      input.placeholder = 'YYYY-MM-DD'
      input.value = value ?? ''
      input.setAttribute('aria-label', label)
      const picker = document.createElement('input')
      picker.type = 'date'
      picker.className = 'mdb-date-native-picker'
      picker.value = input.value
      picker.tabIndex = -1
      picker.setAttribute('aria-hidden', 'true')
      const calendar = document.createElement('button')
      calendar.type = 'button'
      calendar.className = 'mdb-date-button'
      calendar.innerHTML = calendarIcon
      calendar.setAttribute('aria-label', `Choose ${label}`)
      calendar.addEventListener('click', () => {
        picker.value = parsePastedDate(input.value, navigator.language) ?? savedValue
        try { picker.showPicker() } catch { picker.focus(); picker.click() }
      })
      let savedValue = input.value
      function saveDate(raw) {
        const parsed = raw.trim() === '' ? '' : parsePastedDate(raw, navigator.language)
        if (parsed === null) {
          input.value = savedValue
          notice.show('Could not recognize the date.', 'error')
          return
        }
        input.value = parsed
        picker.value = parsed
        const write = saveCell(input, row.id, column.id, parsed, savedValue,
          (previous) => { input.value = previous; picker.value = previous },
          (saved) => { savedValue = saved })
        if (write) {
          calendar.disabled = true
          picker.disabled = true
          write.finally(() => { calendar.disabled = false; picker.disabled = false })
        }
      }
      input.addEventListener('paste', (event) => {
        const pasted = event.clipboardData?.getData('text/plain')
        if (pasted === undefined) return
        event.preventDefault()
        saveDate(pasted)
      })
      input.addEventListener('change', () => saveDate(input.value))
      picker.addEventListener('change', () => saveDate(picker.value))
      wrapper.append(input, calendar, picker)
      td.append(wrapper)
      return
    }
    if (['select', 'multi_select', 'relation', 'multi_relation'].includes(column.type)) {
      addChoiceControl(td, row, column, related, label, value)
      return
    }

    const control = document.createElement('input')
    control.className = 'mdb-cell-control'
    control.setAttribute('aria-label', label)
    if (column.type === 'checkbox') {
      control.type = 'checkbox'
      control.checked = value === true
    } else {
      control.type = column.type === 'number' ? 'number' : 'text'
      if (column.type === 'number') control.step = 'any'
      control.value = value ?? ''
    }
    let savedValue = column.type === 'checkbox' ? control.checked : control.value
    control.addEventListener('change', () => {
      const next = column.type === 'checkbox' ? control.checked : control.value
      saveCell(control, row.id, column.id, next, savedValue,
        (previous) => { if (column.type === 'checkbox') control.checked = previous
          else control.value = previous },
        (saved) => { savedValue = saved })
    })
    td.append(control)
  }

  function showTable(data, related) {
    title.textContent = data.database.name
    tableArea.replaceChildren()
    resetRelationCaches()
    if (getActiveSort() && !data.columns.some((column) => column.id === getActiveSort().columnId)) setActiveSort(null)
    const columnIds = data.columns.map((column) => column.id)
    const rowIds = []
    const rowData = new Map()
    const sortButtons = new Map()
    const table = document.createElement('table')
    table.className = 'mdb-data-table'
    const columnWidths = data.columns.length
      ? data.columns.map((column) => column.width ?? (['checkbox', 'image'].includes(column.type) ? 128 : 220))
      : [220]
    const dataColumnCount = columnWidths.length
    const rowHeadingWidth = 108
    const flexibleColumns = data.columns.length
      ? data.columns.map((column, index) => column.width === null ? index : -1).filter((index) => index >= 0)
      : [0]
    const extraWidth = Math.max(0, tableArea.clientWidth - rowHeadingWidth - 56
      - columnWidths.reduce((sum, width) => sum + width, 0))
    for (const [offset, index] of flexibleColumns.entries()) {
      columnWidths[index] = Math.min(1200, columnWidths[index]
        + Math.floor(extraWidth / flexibleColumns.length)
        + (offset < extraWidth % flexibleColumns.length ? 1 : 0))
    }
    let tableWidth = rowHeadingWidth + columnWidths.reduce((sum, width) => sum + width, 0) + 56
    table.style.width = `${tableWidth}px`
    table.style.minWidth = `${tableWidth}px`
    const widths = document.createElement('colgroup')
    const columnCols = []
    for (const [index, width] of [rowHeadingWidth, ...columnWidths, 56].entries()) {
      const col = document.createElement('col')
      col.style.width = `${width}px`
      if (index > 0 && index <= columnWidths.length) columnCols.push(col)
      widths.append(col)
    }
    function setColumnWidth(index, width) {
      const previous = columnWidths[index]
      const next = Math.max(96, Math.min(1200, Math.round(width)))
      if (previous === next) return next
      columnWidths[index] = next
      tableWidth += next - previous
      columnCols[index].style.width = `${next}px`
      table.style.width = `${tableWidth}px`
      table.style.minWidth = `${tableWidth}px`
      return next
    }
    function resizeHandle(column, index) {
      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = 'mdb-column-resize'
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-orientation', 'vertical')
      handle.setAttribute('aria-label', `Resize ${column.name} column`)
      handle.setAttribute('aria-valuemin', '96')
      handle.setAttribute('aria-valuemax', '1200')
      handle.setAttribute('aria-valuenow', String(columnWidths[index]))
      handle.title = 'Drag to resize, or press Left or Right arrow'
      let drag = null
      let keyboardStart = null
      const update = (width) => {
        handle.setAttribute('aria-valuenow', String(setColumnWidth(index, width)))
      }
      function saveWidth(previous) {
        const next = columnWidths[index]
        if (next === previous) return
        handle.disabled = true
        const write = requestJson('PATCH', `${endpoint}/columns/${column.id}/width`, { width: next })
          .then(([response, payload]) => {
            if (!page.isConnected) return
            if (!response.ok) throw new Error(responseError(response, payload))
            column.width = payload.width
          })
          .catch((error) => {
            if (page.isConnected) {
              update(previous)
              notice.show(error.message || 'Could not save column width.', 'error')
            }
          })
          .finally(() => {
            handle.disabled = false
            pendingWrites.delete(write)
          })
        pendingWrites.add(write)
      }
      handle.addEventListener('pointerdown', (event) => {
        if (handle.disabled || event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        handle.setPointerCapture(event.pointerId)
        drag = { pointerId: event.pointerId, x: event.clientX, width: columnWidths[index] }
        tableArea.classList.add('is-resizing-column')
      })
      handle.addEventListener('pointermove', (event) => {
        if (drag?.pointerId === event.pointerId) update(drag.width + event.clientX - drag.x)
      })
      handle.addEventListener('pointerup', (event) => {
        if (drag?.pointerId !== event.pointerId) return
        update(drag.width + event.clientX - drag.x)
        const previous = drag.width
        drag = null
        tableArea.classList.remove('is-resizing-column')
        handle.releasePointerCapture(event.pointerId)
        saveWidth(previous)
      })
      handle.addEventListener('pointercancel', (event) => {
        if (drag?.pointerId !== event.pointerId) return
        update(drag.width)
        drag = null
        tableArea.classList.remove('is-resizing-column')
      })
      handle.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
        if (!step) return
        event.preventDefault()
        event.stopPropagation()
        if (keyboardStart === null) keyboardStart = columnWidths[index]
        update(columnWidths[index] + step)
      })
      handle.addEventListener('keyup', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || keyboardStart === null) return
        saveWidth(keyboardStart)
        keyboardStart = null
      })
      handle.addEventListener('blur', () => {
        if (keyboardStart === null) return
        saveWidth(keyboardStart)
        keyboardStart = null
      })
      return handle
    }
    function updateSortControls() {
      for (const [id, { button, cell, column }] of sortButtons) {
        const direction = getActiveSort()?.columnId === id ? getActiveSort().direction : null
        const next = direction === 'asc' ? 'descending' : direction === 'desc' ? 'saved order' : 'ascending'
        button.innerHTML = direction === 'asc' ? sortUpIcon : direction === 'desc' ? sortDownIcon : sortIcon
        button.setAttribute('aria-label', `Sort ${column.name} ${next}`)
        button.title = `Sort ${next}`
        button.classList.toggle('is-active', direction !== null)
        cell.setAttribute('aria-sort', direction === 'asc' ? 'ascending'
          : direction === 'desc' ? 'descending' : 'none')
      }
    }
    function updateRowDragHandles() {
      body.querySelectorAll('.mdb-drag-handle[data-order-kind="rows"]').forEach((handle) => {
        handle.disabled = getAllRowsLoading() || getActiveSort() !== null || getSearchQuery() !== ''
        handle.draggable = !handle.disabled
      })
    }
    function applyView() {
      emptyRow.hidden = getSearchQuery() === '' || data.rows.length > 0
      updateRowDragHandles()
    }
    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    const numberHead = document.createElement('th')
    numberHead.scope = 'col'
    numberHead.textContent = '#'
    headRow.append(numberHead)
    for (const [index, column] of data.columns.entries()) {
      const cell = document.createElement('th')
      cell.className = 'mdb-column-heading'
      cell.scope = 'col'
      dropTarget(cell, 'columns', index, columnIds)
      const contents = document.createElement('div')
      contents.className = 'mdb-column-heading-content'
      contents.append(dragHandle('columns', column, index, columnIds))
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mdb-column-name-button'
      button.innerHTML = `<span></span>${editIcon}`
      button.querySelector('span').textContent = column.name
      button.title = column.name
      button.setAttribute('aria-label', `Edit column ${column.name}`)
      button.addEventListener('click', () => openColumnDialog(column))
      contents.append(button)
      const sort = document.createElement('button')
      sort.type = 'button'
      sort.className = 'mdb-column-sort'
      sort.addEventListener('click', () => {
        setActiveSort(getActiveSort()?.columnId !== column.id ? { columnId: column.id, direction: 'asc' }
          : getActiveSort().direction === 'asc' ? { columnId: column.id, direction: 'desc' } : null)
        setPageOffset(0)
        refresh()
      })
      contents.append(sort)
      sortButtons.set(column.id, { button: sort, cell, column })
      cell.append(contents, resizeHandle(column, index))
      headRow.append(cell)
    }
    if (data.columns.length === 0) {
      const empty = document.createElement('th')
      empty.className = 'mdb-empty-column'
      empty.setAttribute('aria-label', 'Empty table')
      headRow.append(empty)
    }
    const columnPlaceholder = document.createElement('th')
    columnPlaceholder.className = 'mdb-column-placeholder'
    columnPlaceholder.scope = 'col'
    const addColumn = document.createElement('button')
    addColumn.type = 'button'
    addColumn.className = 'mdb-placeholder-button'
    addColumn.innerHTML = '<span aria-hidden="true">+</span>'
    addColumn.setAttribute('aria-label', 'Add column')
    addColumn.title = 'Add column'
    addColumn.addEventListener('click', () => openColumnDialog())
    columnPlaceholder.append(addColumn)
    headRow.append(columnPlaceholder)
    head.append(headRow)
    const body = document.createElement('tbody')
    updateSortControls()
    function appendRows(rows) {
      const fragment = document.createDocumentFragment()
      for (const row of rows) {
        const index = rowIds.length
        rowIds.push(row.id)
        const tr = document.createElement('tr')
        tr.className = 'mdb-data-row'
        tr.dataset.rowId = String(row.id)
        rowData.set(row.id, row)
        dropTarget(tr, 'rows', index, rowIds)
        const number = document.createElement('th')
        number.scope = 'row'
        number.className = 'mdb-row-heading'
        const numberLabel = document.createElement('span')
        numberLabel.textContent = String(row.position)
        const deleteRow = document.createElement('button')
        deleteRow.type = 'button'
        deleteRow.className = 'mdb-row-delete'
        deleteRow.innerHTML = deleteIcon
        deleteRow.setAttribute('aria-label', `Delete row ${row.position}`)
        deleteRow.title = `Delete row ${row.position}`
        deleteRow.addEventListener('click', () => openDeleteDialog('rows', row))
        number.append(dragHandle('rows', row, index, rowIds), numberLabel, deleteRow)
        tr.append(number)
        for (const column of data.columns) {
          const td = document.createElement('td')
          addCellControl(td, row, column, related)
          tr.append(td)
        }
        if (data.columns.length === 0) {
          const empty = document.createElement('td')
          empty.className = 'mdb-empty-column'
          tr.append(empty)
        }
        const placeholder = document.createElement('td')
        placeholder.className = 'mdb-column-placeholder'
        tr.append(placeholder)
        fragment.append(tr)
      }
      body.insertBefore(fragment, rowPlaceholder)
      applyView()
    }
    const emptyRow = document.createElement('tr')
    emptyRow.className = 'mdb-search-empty'
    emptyRow.hidden = true
    const emptyCell = document.createElement('td')
    emptyCell.colSpan = dataColumnCount + 2
    emptyCell.textContent = 'No matching rows.'
    emptyRow.append(emptyCell)
    const rowPlaceholder = document.createElement('tr')
    rowPlaceholder.className = 'mdb-row-placeholder'
    const rowCell = document.createElement('th')
    rowCell.scope = 'row'
    const addRow = document.createElement('button')
    addRow.type = 'button'
    addRow.className = 'mdb-placeholder-button'
    addRow.innerHTML = '<span aria-hidden="true">+</span>'
    addRow.setAttribute('aria-label', 'Add row')
    addRow.title = 'Add row'
    addRow.addEventListener('click', () => createRow(addRow))
    rowCell.append(addRow)
    rowPlaceholder.append(rowCell)
    for (let index = 0; index < dataColumnCount; index += 1) {
      rowPlaceholder.append(document.createElement('td'))
    }
    const corner = document.createElement('td')
    corner.className = 'mdb-column-placeholder'
    rowPlaceholder.append(corner)
    body.append(emptyRow, rowPlaceholder)
    table.append(widths, head, body)
    tableArea.append(table)
    appendRows(data.rows)
    return {
      database: data.database,
      rows: rowData,
      appendPage(rows) { data.rows.push(...rows); appendRows(rows) },
      updateRowDragHandles,
    }
  }

  return { showTable }
}
