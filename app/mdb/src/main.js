import './style.css'
import { startAuthApp } from '../../shared/auth-app.js'
import { createPageNotice } from '../../shared/page-notice.js'
import { editIcon, removeIcon, deleteIcon } from '../../shared/icons.js'
import { parsePastedDate } from './date-parse.js'

const databaseIcon = `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
  <ellipse cx="24" cy="10" rx="17" ry="6" />
  <path d="M7 10v28c0 3.3 7.6 6 17 6s17-2.7 17-6V10" />
  <path d="M7 24c0 3.3 7.6 6 17 6s17-2.7 17-6M7 31c0 3.3 7.6 6 17 6s17-2.7 17-6" />
</svg>`
const dragIcon = `<svg viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
  <circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/>
  <circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/>
  <circle cx="5" cy="16" r="1.5"/><circle cx="11" cy="16" r="1.5"/>
</svg>`
const calendarIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
  <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>
</svg>`

function renderDatabases(app, { requestJson, postJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="mdb-page">
      <header class="mdb-heading"><h1 class="section-title">Databases</h1></header>
      <p id="mdb-status" class="form-status" role="status" aria-live="polite"></p>
      <section id="mdb-grid" class="mdb-grid" aria-label="Your databases"></section>
    </main>
    <dialog id="mdb-create-dialog" class="mdb-dialog" aria-labelledby="mdb-create-title">
      <h2 id="mdb-create-title">Create database</h2>
      <form id="mdb-create-form">
        <label class="field"><span>Name</span><input name="name" maxlength="100" required autocomplete="off" /></label>
        <p id="mdb-create-status" class="form-status" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button id="mdb-create-cancel" class="auth-button auth-button-secondary" type="button">Cancel</button>
          <button class="auth-button auth-button-primary" type="submit">Create</button>
        </div>
      </form>
    </dialog>
  `

  const notice = createPageNotice(page.querySelector('.mdb-page'))
  const grid = page.querySelector('#mdb-grid')
  const status = page.querySelector('#mdb-status')
  const dialog = page.querySelector('#mdb-create-dialog')
  const form = page.querySelector('#mdb-create-form')
  const formStatus = page.querySelector('#mdb-create-status')

  function showDatabases(databases) {
    grid.replaceChildren()
    const create = document.createElement('button')
    create.type = 'button'
    create.className = 'mdb-card mdb-card-create'
    create.innerHTML = '<span class="mdb-create-icon" aria-hidden="true">+</span><strong>Create database</strong>'
    create.addEventListener('click', () => {
      form.reset()
      setStatus(formStatus, '')
      dialog.showModal()
      form.elements.name.focus()
    })
    grid.append(create)
    for (const database of databases) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'mdb-card'
      card.innerHTML = `<span class="mdb-card-icon">${databaseIcon}</span><h2></h2>`
      card.querySelector('h2').textContent = database.name
      card.addEventListener('click', () => { window.location.hash = `database?id=${database.id}` })
      grid.append(card)
    }
  }

  async function loadDatabases() {
    setStatus(status, 'Loading databases…')
    try {
      const [response, payload] = await requestJson('GET', '/api/mdb/databases')
      if (!page.isConnected) return false
      if (!response.ok) {
        setStatus(status, responseError(response, payload), true)
        return false
      }
      showDatabases(payload.databases)
      setStatus(status, '')
      return true
    } catch {
      if (page.isConnected) setStatus(status, 'Could not load databases. Please try again.', true)
      return false
    }
  }

  page.querySelector('#mdb-create-cancel').addEventListener('click', () => dialog.close())
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = form.querySelector('[type="submit"]')
    if (button.disabled) return
    button.disabled = true
    setStatus(formStatus, '')
    try {
      const [response, payload] = await postJson('/api/mdb/databases', { name: form.elements.name.value.trim() })
      if (!page.isConnected) return
      if (!response.ok) {
        setStatus(formStatus, responseError(response, payload), true)
        return
      }
      dialog.close()
      if (await loadDatabases()) notice.show(`Database “${payload.name}” created.`)
    } catch {
      if (page.isConnected) setStatus(formStatus, 'Could not create database. Please try again.', true)
    } finally {
      button.disabled = false
    }
  })

  loadDatabases()
}

function renderDatabaseEditor(app, { requestJson, postJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  const databaseId = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id'))
  if (!Number.isSafeInteger(databaseId) || databaseId < 1) {
    page.innerHTML = '<main class="mdb-page"><a class="back-button" href="#home">← Databases</a><p>Database not found.</p></main>'
    return
  }
  const endpoint = `/api/mdb/databases/${databaseId}`
  page.innerHTML = `
    <main class="mdb-page mdb-editor">
      <header class="mdb-editor-heading">
        <div class="mdb-editor-heading-main">
          <a class="back-button" href="#home">← Databases</a>
          <h1 id="mdb-editor-title" class="section-title">Database</h1>
        </div>
        <button id="mdb-import-button" class="auth-button auth-button-secondary" type="button">Import CSV</button>
        <input id="mdb-import-file" type="file" accept=".csv,text/csv" hidden />
      </header>
      <p id="mdb-editor-status" class="form-status" role="status" aria-live="polite">Loading database…</p>
      <div id="mdb-table-area" class="mdb-table-area"></div>
    </main>
    <dialog id="mdb-column-dialog" class="mdb-dialog" aria-labelledby="mdb-column-title">
      <div class="mdb-dialog-heading">
        <h2 id="mdb-column-title">Add column</h2>
        <button id="mdb-column-delete" class="mdb-dialog-delete" type="button" aria-label="Delete column" title="Delete column" hidden>${deleteIcon}</button>
      </div>
      <form id="mdb-column-form">
        <label class="field"><span>Column name</span><input name="name" maxlength="100" required autocomplete="off" /></label>
        <label class="field"><span>Type</span><select name="type">
          <option value="text">Text</option><option value="number">Number</option>
          <option value="date">Date</option><option value="checkbox">Checkbox</option>
          <option value="select">Select</option><option value="multi_select">Multi-select</option>
          <option value="relation">Relation</option><option value="multi_relation">Multi-relation</option>
        </select></label>
        <div id="mdb-options-field" class="field" hidden>
          <span>Options</span>
          <div id="mdb-column-options" class="mdb-column-option-list"></div>
        </div>
        <label id="mdb-relation-field" class="field" hidden><span>Related database</span><select name="relation_database_id"></select></label>
        <label id="mdb-relation-display-field" class="field" hidden><span>Display column</span><select name="relation_display_column_id"></select></label>
        <p id="mdb-column-status" class="form-status" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button id="mdb-column-cancel" class="auth-button auth-button-secondary" type="button">Cancel</button>
          <button id="mdb-column-submit" class="auth-button auth-button-primary" type="submit">Add column</button>
        </div>
      </form>
    </dialog>
    <dialog id="mdb-multi-dialog" class="mdb-dialog" aria-labelledby="mdb-multi-title">
      <h2 id="mdb-multi-title">Select options</h2>
      <form id="mdb-multi-form">
        <div id="mdb-multi-options" class="mdb-option-list"></div>
        <p id="mdb-multi-status" class="form-status" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button id="mdb-multi-cancel" class="auth-button auth-button-secondary" type="button">Cancel</button>
          <button class="auth-button auth-button-primary" type="submit">Save</button>
        </div>
      </form>
    </dialog>
    <dialog id="mdb-delete-dialog" class="mdb-dialog" aria-labelledby="mdb-delete-title">
      <h2 id="mdb-delete-title"></h2>
      <p id="mdb-delete-description"></p>
      <p id="mdb-delete-status" class="form-status" role="status" aria-live="polite"></p>
      <div class="dialog-actions">
        <button id="mdb-delete-cancel" class="auth-button auth-button-secondary" type="button">Cancel</button>
        <button id="mdb-delete-confirm" class="auth-button auth-button-primary" type="button">Delete</button>
      </div>
    </dialog>
    <dialog id="mdb-import-dialog" class="mdb-dialog mdb-import-dialog" aria-labelledby="mdb-import-title">
      <h2 id="mdb-import-title">Review CSV columns</h2>
      <p id="mdb-import-summary"></p>
      <form id="mdb-import-form">
        <div id="mdb-import-columns" class="mdb-import-columns"></div>
        <p id="mdb-import-status" class="form-status" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button id="mdb-import-cancel" class="auth-button auth-button-secondary" type="button">Cancel</button>
          <button class="auth-button auth-button-primary" type="submit">Import</button>
        </div>
      </form>
    </dialog>
  `

  const notice = createPageNotice(page.querySelector('.mdb-page'))
  const title = page.querySelector('#mdb-editor-title')
  const status = page.querySelector('#mdb-editor-status')
  const tableArea = page.querySelector('#mdb-table-area')
  const dialog = page.querySelector('#mdb-column-dialog')
  const columnForm = page.querySelector('#mdb-column-form')
  const columnStatus = page.querySelector('#mdb-column-status')
  const columnOptions = page.querySelector('#mdb-column-options')
  const typeSelect = columnForm.elements.type
  const relationSelect = columnForm.elements.relation_database_id
  const displaySelect = columnForm.elements.relation_display_column_id
  const multiDialog = page.querySelector('#mdb-multi-dialog')
  const multiForm = page.querySelector('#mdb-multi-form')
  const multiOptions = page.querySelector('#mdb-multi-options')
  const multiStatus = page.querySelector('#mdb-multi-status')
  const deleteDialog = page.querySelector('#mdb-delete-dialog')
  const deleteStatus = page.querySelector('#mdb-delete-status')
  const deleteConfirm = page.querySelector('#mdb-delete-confirm')
  const deleteCancel = page.querySelector('#mdb-delete-cancel')
  const importButton = page.querySelector('#mdb-import-button')
  const importFileInput = page.querySelector('#mdb-import-file')
  const importDialog = page.querySelector('#mdb-import-dialog')
  const importForm = page.querySelector('#mdb-import-form')
  const importColumns = page.querySelector('#mdb-import-columns')
  const importStatus = page.querySelector('#mdb-import-status')
  const pendingWrites = new Set()
  let editingColumn = null
  let databases = []
  let relatedDatabases = new Map()
  let displayLoad = 0
  let multiCell = null
  let savingMultiDialog = false
  let deletingItem = null
  let csvFile = null
  let importingCsv = false
  let dragState = null
  let touchDrag = null
  let reordering = false

  function clearDropMarkers() {
    tableArea.querySelectorAll('[data-drop-side]').forEach((item) => { delete item.dataset.dropSide })
  }

  async function saveOrder(kind, oldIds, nextIds, focusId = null) {
    if (reordering || oldIds.every((id, index) => id === nextIds[index])) return
    reordering = true
    setStatus(status, `Saving ${kind} order…`)
    try {
      await Promise.all([...pendingWrites])
      const [response, payload] = await requestJson('PUT', `${endpoint}/${kind}/order`, { ids: nextIds })
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
    handle.draggable = true
    handle.innerHTML = dragIcon
    handle.dataset.orderKind = kind
    handle.dataset.orderId = String(item.id)
    const direction = kind === 'columns' ? 'left or right' : 'up or down'
    handle.setAttribute('aria-label', `Reorder ${kind === 'columns' ? 'column' : 'row'} ${index + 1}`)
    handle.title = `Drag to reorder, or press Alt + Arrow ${direction}`
    handle.addEventListener('dragstart', (event) => {
      if (reordering || touchDrag) { event.preventDefault(); return }
      dragState = { kind, id: item.id }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(item.id))
    })
    handle.addEventListener('dragend', () => { dragState = null; clearDropMarkers() })
    handle.addEventListener('keydown', (event) => {
      const step = kind === 'columns'
        ? (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)
        : (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
      if (!event.altKey || !step || index + step < 0 || index + step >= ids.length) return
      event.preventDefault()
      const nextIds = [...ids]
      ;[nextIds[index], nextIds[index + step]] = [nextIds[index + step], nextIds[index]]
      saveOrder(kind, ids, nextIds, item.id)
    })
    handle.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' || reordering) return
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
      if (dragState?.kind !== kind || reordering) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      markDropTarget(element, kind, event.clientX, event.clientY)
    })
    element.addEventListener('drop', (event) => {
      if (dragState?.kind !== kind || reordering) return
      event.preventDefault()
      const movedId = dragState.id
      const after = element.dataset.dropSide === 'after'
      dragState = null
      clearDropMarkers()
      reorderFromDrop(kind, ids, movedId, index, after)
    })
  }

  function saveCell(control, rowId, columnId, value, previous, restore, saved) {
    if (JSON.stringify(value) === JSON.stringify(previous)) return null
    control.disabled = true
    notice.show('Saving cell…', 'info')
    const write = requestJson('PUT', `${endpoint}/rows/${rowId}/cells/${columnId}`, { value })
      .then(([response, payload]) => {
        if (!page.isConnected) return
        if (!response.ok) throw new Error(responseError(response, payload))
        saved(payload.value)
        setStatus(status, '')
        notice.show('Saved.')
        return true
      })
      .catch((error) => {
        if (!page.isConnected) return
        restore(previous)
        setStatus(status, '')
        notice.show(error.message || 'Could not save cell.', 'error')
        return false
      })
      .finally(() => {
        control.disabled = false
        pendingWrites.delete(write)
      })
    pendingWrites.add(write)
    return write
  }

  function appendChoiceOption(value, label, checked = false, single = false) {
    const optionLabel = document.createElement('label')
    optionLabel.className = 'mdb-option'
    const choice = document.createElement('input')
    choice.type = single ? 'radio' : 'checkbox'
    if (single) choice.name = 'mdb-single-option'
    choice.dataset.choice = ''
    choice.value = String(value)
    optionLabel.append(choice, document.createTextNode(label))
    multiOptions.append(optionLabel)
    choice.checked = checked
  }

  function optionPlaceholder(className, createRow, text = 'Add option') {
    const placeholder = document.createElement('div')
    placeholder.className = className
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = text
    input.setAttribute('aria-label', text)
    input.addEventListener('focus', () => {
      if (savingMultiDialog) { input.blur(); return }
      createRow().focus()
    })
    placeholder.addEventListener('click', (event) => {
      if (event.target === placeholder) input.focus()
    })
    placeholder.append(input)
    return placeholder
  }

  function appendAddOptionPlaceholder() {
    const placeholder = optionPlaceholder('mdb-option mdb-option-placeholder', () => {
      const row = document.createElement('div')
      row.className = 'mdb-option mdb-option-draft'
      const choice = document.createElement('input')
      choice.type = multiCell?.isSingle ? 'radio' : 'checkbox'
      if (multiCell?.isSingle) choice.name = 'mdb-single-option'
      choice.dataset.choice = ''
      const input = document.createElement('input')
      input.type = 'text'
      input.maxLength = 100
      input.placeholder = 'Option name'
      input.setAttribute('aria-label', 'New option name')
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'mdb-column-option-remove'
      remove.innerHTML = removeIcon
      remove.setAttribute('aria-label', 'Remove new option')
      remove.addEventListener('click', () => row.remove())
      row.append(choice, input, remove)
      multiOptions.insertBefore(row, placeholder)
      choice.checked = true
      return input
    })
    multiOptions.append(placeholder)
  }

  function relatedRowValueColumn(column) {
    const target = relatedDatabases.get(column.relation_database_id)
    if (!target) return null
    const supported = (item) => ['text', 'number', 'date', 'select'].includes(item.type)
    if (column.relation_display_column_id !== null) {
      const display = target.columns.find((item) => item.id === column.relation_display_column_id)
      return display && supported(display) ? display : null
    }
    return target.columns.find((item) => item.type === 'text')
      ?? target.columns.find(supported) ?? null
  }

  function appendAddRelatedRowPlaceholder(column) {
    const valueColumn = relatedRowValueColumn(column)
    multiCell.createColumn = valueColumn
    const placeholder = optionPlaceholder('mdb-option mdb-option-placeholder', () => {
      const draft = document.createElement('div')
      draft.className = 'mdb-option mdb-option-draft mdb-related-row-draft'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.dataset.choice = ''
      checkbox.checked = true
      let editor = checkbox
      if (valueColumn?.type === 'select') {
        editor = document.createElement('select')
        const empty = document.createElement('option')
        empty.value = ''
        empty.textContent = 'Choose option'
        editor.append(empty)
        for (const value of valueColumn.options) {
          const option = document.createElement('option')
          option.value = value
          option.textContent = value
          editor.append(option)
        }
        editor.required = true
        editor.dataset.relatedValue = ''
        editor.setAttribute('aria-label', `New ${valueColumn.name}`)
      } else if (valueColumn) {
        editor = document.createElement('input')
        editor.type = 'text'
        editor.maxLength = 100
        editor.placeholder = valueColumn.type === 'date' ? 'YYYY-MM-DD'
          : valueColumn.type === 'number' ? 'Number' : valueColumn.name
        editor.dataset.relatedValue = ''
        editor.setAttribute('aria-label', `New ${valueColumn.name}`)
      } else {
        const text = document.createElement('span')
        text.className = 'mdb-related-blank-label'
        text.textContent = 'New blank row'
        draft.append(checkbox, text)
      }
      if (valueColumn) draft.append(checkbox, editor)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'mdb-column-option-remove'
      remove.innerHTML = removeIcon
      remove.setAttribute('aria-label', 'Remove new row')
      remove.addEventListener('click', () => draft.remove())
      draft.append(remove)
      multiOptions.insertBefore(draft, placeholder)
      return editor
    }, valueColumn ? 'Add related row' : 'Add blank row')
    multiOptions.append(placeholder)
  }

  function rowLabel(row, columns, displayColumnId) {
    const explicit = displayColumnId !== null
    const selected = !explicit ? null
      : columns.find((column) => column.id === displayColumnId)
    const text = !explicit
      ? columns.find((column) => column.type === 'text' && row.values?.[column.id]) : null
    const first = selected ?? text ?? (!explicit
      ? columns.find((column) => row.values?.[column.id] !== undefined) : null)
    if (!first) return explicit ? '—' : `Row ${row.position}`
    const value = row.values[first.id] ?? (first.type === 'checkbox' ? false : undefined)
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      return explicit ? '—' : `Row ${row.position}`
    }
    const shown = Array.isArray(value) ? value.join(', ')
      : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
    return explicit ? shown : `Row ${row.position}: ${shown}`
  }

  function relatedChoices(column, related) {
    const database = related.get(column.relation_database_id)
    return database?.rows.map((row) => ({
      id: row.id,
      label: rowLabel(row, database.columns, column.relation_display_column_id),
    })) ?? []
  }

  function addCellControl(td, row, column, related) {
    const label = `${column.name}, row ${row.position}`
    const value = row.values?.[column.id]
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
    if (column.type === 'select' || column.type === 'multi_select' || column.type === 'multi_relation') {
      const isRelation = column.type === 'multi_relation'
      const isSingle = column.type === 'select'
      const choices = isRelation
        ? relatedChoices(column, related).map((item) => [item.id, item.label])
        : column.options.map((option) => [option, option])
      const choiceLabels = new Map(choices)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mdb-multi-button'
      let savedValue = isSingle ? (value ?? '') : (Array.isArray(value) ? value : [])
      const display = () => {
        button.textContent = isSingle
          ? (savedValue || 'Choose option')
          : savedValue.length
            ? savedValue.map((id) => choiceLabels.get(id)
              ?? (isRelation ? `Missing row ${id}` : id)).join(', ')
            : isRelation ? 'Choose rows' : 'Select options'
      }
      display()
      button.setAttribute('aria-label', label)
      button.addEventListener('click', () => {
        multiCell = { button, row, column, isRelation, isSingle, choiceLabels,
          get value() { return savedValue }, set value(next) { savedValue = next; display() } }
        page.querySelector('#mdb-multi-title').textContent = isRelation ? 'Choose related rows'
          : isSingle ? 'Choose option' : 'Select options'
        multiOptions.replaceChildren()
        setStatus(multiStatus, '')
        if (isSingle) appendChoiceOption('', 'No option', savedValue === '', true)
        for (const [choiceValue, choiceLabel] of choices) {
          appendChoiceOption(choiceValue, choiceLabel,
            isSingle ? savedValue === choiceValue : savedValue.includes(choiceValue), isSingle)
        }
        if (isRelation) appendAddRelatedRowPlaceholder(column)
        else appendAddOptionPlaceholder()
        multiDialog.showModal()
      })
      td.append(button)
      return
    }

    const control = document.createElement(column.type === 'relation' ? 'select' : 'input')
    control.className = 'mdb-cell-control'
    control.setAttribute('aria-label', label)
    if (column.type === 'checkbox') {
      control.type = 'checkbox'
      control.checked = value === true
    } else if (column.type === 'relation') {
      const empty = document.createElement('option')
      empty.value = ''
      empty.textContent = 'Choose row'
      control.append(empty)
      const choices = relatedChoices(column, related).map((item) => [String(item.id), item.label])
      for (const [choiceValue, choiceLabel] of choices) {
        const option = document.createElement('option')
        option.value = choiceValue
        option.textContent = choiceLabel
        control.append(option)
      }
      if (value !== null && value !== undefined && !choices.some(([id]) => id === String(value))) {
        const missing = document.createElement('option')
        missing.value = String(value)
        missing.textContent = `Missing row ${value}`
        control.append(missing)
      }
      control.value = value === null || value === undefined ? '' : String(value)
    } else {
      control.type = column.type === 'number' ? 'number' : 'text'
      if (column.type === 'number') control.step = 'any'
      control.value = value ?? ''
    }
    let savedValue = column.type === 'checkbox' ? control.checked
      : column.type === 'relation' ? (value ?? null) : control.value
    control.addEventListener('change', () => {
      const next = column.type === 'checkbox' ? control.checked
        : column.type === 'relation' ? (control.value ? Number(control.value) : null) : control.value
      saveCell(control, row.id, column.id, next, savedValue,
        (previous) => { if (column.type === 'checkbox') control.checked = previous
          else control.value = previous ?? '' },
        (saved) => { savedValue = saved })
    })
    td.append(control)
  }

  function showTable(data, related) {
    title.textContent = data.database.name
    tableArea.replaceChildren()
    const columnIds = data.columns.map((column) => column.id)
    const rowIds = data.rows.map((row) => row.id)
    const table = document.createElement('table')
    table.className = 'mdb-data-table'
    const columnWidths = data.columns.length
      ? data.columns.map((column) => column.type === 'checkbox' ? 128 : 220)
      : [220]
    const dataColumnCount = columnWidths.length
    const rowHeadingWidth = 108
    const tableWidth = rowHeadingWidth + columnWidths.reduce((sum, width) => sum + width, 0) + 56
    table.style.minWidth = `${tableWidth}px`
    if (data.columns.length && data.columns.every((column) => column.type === 'checkbox')) {
      table.style.width = `${tableWidth}px`
    }
    const widths = document.createElement('colgroup')
    for (const width of [rowHeadingWidth, ...data.columns.map((column) => column.type === 'checkbox' ? 128 : null),
      ...(data.columns.length ? [] : [null]), 56]) {
      const col = document.createElement('col')
      if (width !== null) col.style.width = `${width}px`
      widths.append(col)
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
      cell.append(contents)
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
    for (const [index, row] of data.rows.entries()) {
      const tr = document.createElement('tr')
      tr.className = 'mdb-data-row'
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
      body.append(tr)
    }
    const rowPlaceholder = document.createElement('tr')
    rowPlaceholder.className = 'mdb-row-placeholder'
    const rowCell = document.createElement('td')
    rowCell.colSpan = dataColumnCount + 2
    const addRow = document.createElement('button')
    addRow.type = 'button'
    addRow.className = 'mdb-placeholder-button'
    addRow.innerHTML = '<span aria-hidden="true">+</span> Add row'
    addRow.addEventListener('click', () => createRow(addRow))
    rowCell.append(addRow)
    rowPlaceholder.append(rowCell)
    body.append(rowPlaceholder)
    table.append(widths, head, body)
    tableArea.append(table)
  }

  async function refresh() {
    setStatus(status, 'Loading database…')
    try {
      const [[response, payload], [listResponse, listPayload]] = await Promise.all([
        requestJson('GET', endpoint), requestJson('GET', '/api/mdb/databases'),
      ])
      if (!page.isConnected) return false
      if (!response.ok) throw new Error(responseError(response, payload))
      if (!listResponse.ok) throw new Error(responseError(listResponse, listPayload))
      databases = listPayload.databases
      const related = new Map()
      await Promise.all([...new Set(payload.columns.filter((column) => ['relation', 'multi_relation'].includes(column.type))
        .map((column) => column.relation_database_id))].map(async (id) => {
        const [relatedResponse, relatedPayload] = id === databaseId
          ? [response, payload] : await requestJson('GET', `/api/mdb/databases/${id}`)
        if (!relatedResponse.ok) throw new Error(responseError(relatedResponse, relatedPayload))
        related.set(id, relatedPayload)
      }))
      if (!page.isConnected) return false
      relatedDatabases = related
      showTable(payload, related)
      setStatus(status, '')
      return true
    } catch (error) {
      if (page.isConnected) setStatus(status, error.message || 'Could not load database.', true)
      return false
    }
  }

  async function sendCsv(path, settings = null) {
    const body = new FormData()
    body.append('file', csvFile)
    if (settings !== null) {
      body.append('types', JSON.stringify(settings.types))
      body.append('relations', JSON.stringify(settings.relations))
    }
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', body })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(responseError(response, payload))
    return payload
  }

  async function importCsv(settings) {
    if (!csvFile || importingCsv) return
    importingCsv = true
    importButton.disabled = true
    const controls = [...importForm.querySelectorAll('button, select')]
      .map((control) => [control, control.disabled])
    controls.forEach(([control]) => { control.disabled = true })
    if (importDialog.open) setStatus(importStatus, 'Importing CSV…')
    else notice.show('Importing CSV…', 'info')
    try {
      await Promise.all([...pendingWrites])
      const result = await sendCsv('/import', settings)
      if (!page.isConnected) return
      if (importDialog.open) importDialog.close()
      csvFile = null
      const message = `${result.rows_added} row${result.rows_added === 1 ? '' : 's'} and ${result.columns_added} column${result.columns_added === 1 ? '' : 's'} added${result.related_rows_added ? `; ${result.related_rows_added} related row${result.related_rows_added === 1 ? '' : 's'} created` : ''}${result.rows_skipped ? `; ${result.rows_skipped} existing row${result.rows_skipped === 1 ? '' : 's'} skipped` : ''}.`
      if (await refresh()) notice.show(message)
      else notice.show(`CSV imported, but the table could not refresh.`, 'warning')
    } catch (error) {
      if (page.isConnected) {
        if (importDialog.open) setStatus(importStatus, error.message || 'Could not import CSV.', true)
        else notice.show(error.message || 'Could not import CSV.', 'error')
      }
    } finally {
      importingCsv = false
      importButton.disabled = false
      controls.forEach(([control, disabled]) => { control.disabled = disabled })
    }
  }

  const importTypeLabels = {
    text: 'Text', number: 'Number', date: 'Date', checkbox: 'Checkbox',
    select: 'Select', multi_select: 'Multi-select (comma-separated)',
    relation: 'Relation', multi_relation: 'Multi-relation (comma-separated)',
  }
  const importLookupTypes = new Set(['text', 'number', 'date', 'select'])
  const importDatabaseColumns = new Map()
  async function loadImportLookupColumns(databaseId) {
    if (importDatabaseColumns.has(databaseId)) return importDatabaseColumns.get(databaseId)
    const [response, payload] = await requestJson('GET', `/api/mdb/databases/${databaseId}`)
    if (!response.ok) throw new Error(responseError(response, payload))
    const columns = payload.columns.filter((column) => importLookupTypes.has(column.type))
    importDatabaseColumns.set(databaseId, columns)
    return columns
  }

  function appendImportColumn(column) {
    const row = document.createElement('div')
    row.className = 'mdb-import-column field'
    row.dataset.columnName = column.name
    row.dataset.existing = String(column.existing)
    const name = document.createElement('span')
    name.textContent = column.name
    const sample = document.createElement('small')
    sample.textContent = column.samples.length ? `Examples: ${column.samples.join(' · ')}` : 'No nonempty values'
    const typeLabel = document.createElement('label')
    typeLabel.className = 'field'
    const typeCaption = document.createElement('span')
    typeCaption.textContent = 'Type'
    const typeSelect = document.createElement('select')
    typeSelect.dataset.importType = ''
    typeSelect.required = true
    if (!column.type) {
      const empty = document.createElement('option')
      empty.value = ''
      empty.textContent = 'Choose type'
      typeSelect.append(empty)
    }
    for (const type of column.existing ? [column.type] : column.candidates) {
      const option = document.createElement('option')
      option.value = type
      option.textContent = importTypeLabels[type]
      typeSelect.append(option)
    }
    typeSelect.value = column.type ?? ''
    typeSelect.disabled = column.existing
    typeLabel.append(typeCaption, typeSelect)
    const relationFields = document.createElement('div')
    relationFields.className = 'mdb-import-relation-fields'
    const databaseLabel = document.createElement('label')
    databaseLabel.className = 'field'
    databaseLabel.append(document.createElement('span'))
    databaseLabel.firstChild.textContent = 'Related database'
    const databaseSelect = document.createElement('select')
    databaseSelect.dataset.importDatabase = ''
    databaseSelect.required = true
    const chooseDatabase = document.createElement('option')
    chooseDatabase.value = ''
    chooseDatabase.textContent = 'Choose database'
    databaseSelect.append(chooseDatabase)
    for (const database of databases) {
      const option = document.createElement('option')
      option.value = String(database.id)
      option.textContent = database.name
      databaseSelect.append(option)
    }
    databaseSelect.value = column.relation_database_id ? String(column.relation_database_id) : ''
    databaseSelect.disabled = column.existing
    databaseLabel.append(databaseSelect)
    const lookupLabel = document.createElement('label')
    lookupLabel.className = 'field'
    const lookupCaption = document.createElement('span')
    lookupCaption.textContent = 'Match values using'
    const lookupSelect = document.createElement('select')
    lookupSelect.dataset.importLookup = ''
    lookupSelect.required = true
    lookupLabel.append(lookupCaption, lookupSelect)
    const hint = document.createElement('small')
    hint.textContent = 'Missing values create rows in the related database.'
    relationFields.append(databaseLabel, lookupLabel, hint)
    let requestNumber = 0
    async function updateLookupColumns() {
      const currentRequest = ++requestNumber
      lookupSelect.replaceChildren()
      const placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = 'Choose lookup column'
      lookupSelect.append(placeholder)
      lookupSelect.disabled = false
      const databaseId = Number(databaseSelect.value)
      if (!Number.isSafeInteger(databaseId) || databaseId < 1) {
        hint.textContent = 'Choose a related database.'
        return
      }
      placeholder.textContent = 'Loading related columns…'
      hint.textContent = 'Loading related columns…'
      try {
        const columns = await loadImportLookupColumns(databaseId)
        if (currentRequest !== requestNumber || !page.isConnected) return
        placeholder.textContent = 'Choose lookup column'
        for (const item of columns) {
          const option = document.createElement('option')
          option.value = String(item.id)
          option.textContent = item.name
          lookupSelect.append(option)
        }
        if (column.relation_display_column_id
          && columns.some((item) => item.id === Number(column.relation_display_column_id))) {
          lookupSelect.value = String(column.relation_display_column_id)
        }
        hint.textContent = columns.length
          ? 'Missing values create rows in the related database.'
          : 'Add a text, number, date, or select column to the related database first.'
      } catch (error) {
        if (currentRequest === requestNumber) hint.textContent = error.message || 'Could not load related columns.'
      }
    }
    function updateType() {
      const isRelation = ['relation', 'multi_relation'].includes(typeSelect.value)
      relationFields.hidden = !isRelation
      databaseSelect.disabled = column.existing || !isRelation
      if (isRelation) updateLookupColumns()
      else { requestNumber++; lookupSelect.disabled = true }
    }
    typeSelect.addEventListener('change', updateType)
    databaseSelect.addEventListener('change', updateLookupColumns)
    row.append(name, sample, typeLabel, relationFields)
    importColumns.append(row)
    updateType()
  }
  importButton.addEventListener('click', () => importFileInput.click())
  importFileInput.addEventListener('change', async () => {
    const file = importFileInput.files?.[0]
    importFileInput.value = ''
    if (!file || importButton.disabled) return
    if (file.size > 8388608) { notice.show('CSV file is too large (8 MiB maximum).', 'error'); return }
    csvFile = file
    importButton.disabled = true
    notice.show('Reading CSV…', 'info')
    try {
      const preview = await sendCsv('/import/preview')
      if (!page.isConnected) return
      importDatabaseColumns.clear()
      const configurable = preview.columns.filter((column) => !column.existing
        || ['relation', 'multi_relation'].includes(column.type))
      if (configurable.length === 0) {
        importButton.disabled = false
        await importCsv({ types: {}, relations: {} })
        return
      }
      page.querySelector('#mdb-import-summary').textContent =
        `${preview.row_count} row${preview.row_count === 1 ? '' : 's'} found. Review new columns and choose how relation values are matched.`
      importColumns.replaceChildren()
      for (const column of configurable) appendImportColumn(column)
      setStatus(importStatus, '')
      notice.clear()
      importDialog.showModal()
      importColumns.querySelector('select:not(:disabled)')?.focus()
    } catch (error) {
      if (page.isConnected) notice.show(error.message || 'Could not read CSV.', 'error')
      csvFile = null
    } finally {
      importButton.disabled = false
    }
  })
  importDialog.addEventListener('cancel', (event) => {
    if (importingCsv) event.preventDefault()
  })
  page.querySelector('#mdb-import-cancel').addEventListener('click', () => {
    if (!importingCsv) importDialog.close()
  })
  importDialog.addEventListener('close', () => {
    if (!importingCsv) csvFile = null
  })
  importForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const types = Object.create(null)
    const relations = Object.create(null)
    for (const row of importColumns.children) {
      const type = row.querySelector('[data-import-type]').value
      if (row.dataset.existing !== 'true') types[row.dataset.columnName] = type
      if (['relation', 'multi_relation'].includes(type)) {
        relations[row.dataset.columnName] = {
          database_id: Number(row.querySelector('[data-import-database]').value),
          lookup_column_id: Number(row.querySelector('[data-import-lookup]').value),
        }
      }
    }
    importCsv({ types, relations })
  })

  function openDeleteDialog(kind, item) {
    deletingItem = { kind, id: item.id }
    const isColumn = kind === 'columns'
    page.querySelector('#mdb-delete-title').textContent = isColumn
      ? `Delete “${item.name}” column?` : `Delete row ${item.position}?`
    page.querySelector('#mdb-delete-description').textContent = isColumn
      ? 'This removes the column and all its values. Relations using it as a display column will use automatic labels.'
      : 'This removes all values in the row and clears links to it from relation columns.'
    deleteConfirm.textContent = isColumn ? 'Delete column' : 'Delete row'
    setStatus(deleteStatus, '')
    deleteDialog.showModal()
  }

  function openColumnDialog(column = null) {
    displayLoad++
    editingColumn = column
    columnForm.reset()
    columnForm.elements.name.value = column?.name ?? ''
    typeSelect.value = column?.type ?? 'text'
    renderColumnOptions(column?.options ?? [])
    relationSelect.replaceChildren()
    for (const database of databases) {
      const option = document.createElement('option')
      option.value = String(database.id)
      option.textContent = database.name
      relationSelect.append(option)
    }
    relationSelect.value = String(column?.relation_database_id ?? databaseId)
    updateColumnFields()
    page.querySelector('#mdb-column-title').textContent = column ? 'Edit column' : 'Add column'
    page.querySelector('#mdb-column-submit').textContent = column ? 'Save' : 'Add column'
    page.querySelector('#mdb-column-delete').hidden = !column
    setStatus(columnStatus, '')
    dialog.showModal()
    if (['relation', 'multi_relation'].includes(typeSelect.value)) {
      loadDisplayColumns(column?.relation_display_column_id ?? null)
    }
    columnForm.elements.name.focus()
    if (column) columnForm.elements.name.select()
  }
  function addColumnOption(value = '', original = null) {
    const row = document.createElement('div')
    row.className = 'mdb-column-option'
    if (original !== null) row.dataset.original = original
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.maxLength = 100
    input.placeholder = 'Option name'
    input.setAttribute('aria-label', 'Option name')
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'mdb-column-option-remove'
    remove.innerHTML = removeIcon
    remove.setAttribute('aria-label', value ? `Remove option ${value}` : 'Remove empty option')
    remove.title = 'Remove option'
    remove.addEventListener('click', () => row.remove())
    row.append(input, remove)
    columnOptions.insertBefore(row, columnOptions.lastElementChild)
    return input
  }
  function renderColumnOptions(options) {
    columnOptions.replaceChildren()
    columnOptions.append(optionPlaceholder('mdb-column-option-placeholder', addColumnOption))
    for (const option of options) addColumnOption(option, option)
  }
  function collectColumnOptions() {
    const options = []
    const optionRenames = []
    for (const row of columnOptions.querySelectorAll('.mdb-column-option')) {
      const input = row.querySelector('input')
      const name = input.value.trim()
      if (!name) {
        input.focus()
        throw new Error('Enter an option name or remove the empty option.')
      }
      if (options.includes(name)) {
        input.focus()
        throw new Error('Options must be unique.')
      }
      options.push(name)
      if (row.dataset.original !== undefined && row.dataset.original !== name) {
        optionRenames.push({ from: row.dataset.original, to: name })
      }
    }
    if (options.length === 0) throw new Error('Add at least one option.')
    return { options, optionRenames }
  }
  function updateColumnFields() {
    page.querySelector('#mdb-options-field').hidden = !['select', 'multi_select'].includes(typeSelect.value)
    const isRelation = ['relation', 'multi_relation'].includes(typeSelect.value)
    page.querySelector('#mdb-relation-field').hidden = !isRelation
    page.querySelector('#mdb-relation-display-field').hidden = !isRelation
    if (!isRelation) { displayLoad++; displaySelect.disabled = true }
  }
  async function loadDisplayColumns(preferred = null) {
    const targetId = Number(relationSelect.value)
    const sequence = ++displayLoad
    displaySelect.disabled = true
    displaySelect.replaceChildren()
    try {
      let target = relatedDatabases.get(targetId)
      if (!target) {
        const [response, payload] = await requestJson('GET', `/api/mdb/databases/${targetId}`)
        if (!response.ok) throw new Error(responseError(response, payload))
        target = payload
        relatedDatabases.set(targetId, target)
      }
      if (sequence !== displayLoad || !dialog.open) return
      const automatic = document.createElement('option')
      automatic.value = ''
      automatic.textContent = 'Automatic (first filled column)'
      displaySelect.append(automatic)
      for (const column of target.columns) {
        const option = document.createElement('option')
        option.value = String(column.id)
        option.textContent = column.name
        displaySelect.append(option)
      }
      displaySelect.value = preferred === null ? '' : String(preferred)
      displaySelect.disabled = false
    } catch (error) {
      if (sequence === displayLoad && dialog.open) {
        setStatus(columnStatus, error.message || 'Could not load related columns.', true)
      }
    }
  }
  typeSelect.addEventListener('change', () => {
    updateColumnFields()
    if (['relation', 'multi_relation'].includes(typeSelect.value)) loadDisplayColumns()
  })
  relationSelect.addEventListener('change', () => loadDisplayColumns())
  page.querySelector('#mdb-column-cancel').addEventListener('click', () => dialog.close())
  page.querySelector('#mdb-column-delete').addEventListener('click', () => {
    if (!editingColumn) return
    const column = editingColumn
    dialog.close()
    openDeleteDialog('columns', column)
  })
  columnForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (['relation', 'multi_relation'].includes(typeSelect.value) && displaySelect.disabled) {
      setStatus(columnStatus, 'Wait for related columns to load.', true)
      return
    }
    const button = columnForm.querySelector('[type="submit"]')
    if (button.disabled) return
    button.disabled = true
    try {
      await Promise.all([...pendingWrites])
      const { options, optionRenames } = ['select', 'multi_select'].includes(typeSelect.value)
        ? collectColumnOptions() : { options: [], optionRenames: [] }
      const settings = {
        name: columnForm.elements.name.value.trim(),
        type: typeSelect.value,
        options,
        option_renames: optionRenames,
        relation_database_id: ['relation', 'multi_relation'].includes(typeSelect.value) ? Number(relationSelect.value) : null,
        relation_display_column_id: ['relation', 'multi_relation'].includes(typeSelect.value) && displaySelect.value
          ? Number(displaySelect.value) : null,
      }
      const [response, payload] = editingColumn
        ? await requestJson('PATCH', `${endpoint}/columns/${editingColumn.id}`, settings)
        : await postJson(`${endpoint}/columns`, settings)
      if (!page.isConnected) return
      if (!response.ok) throw new Error(responseError(response, payload))
      dialog.close()
      if (await refresh()) notice.show(editingColumn ? 'Column saved.' : 'Column added.')
    } catch (error) {
      if (page.isConnected) setStatus(columnStatus, error.message || 'Could not add column.', true)
    } finally {
      button.disabled = false
    }
  })
  page.querySelector('#mdb-multi-cancel').addEventListener('click', () => {
    if (savingMultiDialog) return
    multiCell = null
    multiDialog.close()
  })
  multiDialog.addEventListener('cancel', (event) => {
    if (savingMultiDialog) event.preventDefault()
  })
  multiDialog.addEventListener('close', () => {
    if (!multiDialog.open) multiCell = null
  })
  multiForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!multiCell || savingMultiDialog) return
    const cell = multiCell
    const previous = cell.value
    const names = []
    const relatedValues = []
    const drafts = [...multiOptions.querySelectorAll('.mdb-option-draft')]
    for (const draft of drafts) {
      if (cell.isRelation) {
        const editor = draft.querySelector('[data-related-value]')
        if (!editor) { relatedValues.push(null); continue }
        let value = editor.value.trim()
        if (cell.createColumn.type === 'date' && value !== '') {
          value = parsePastedDate(value, navigator.language)
          if (value === null) {
            setStatus(multiStatus, 'Could not recognize the date.', true)
            editor.focus()
            return
          }
        }
        if (!value) {
          setStatus(multiStatus, 'Enter a value for each new row.', true)
          editor.focus()
          return
        }
        relatedValues.push(value)
      } else {
        const input = draft.querySelector('input[type="text"]')
        const name = input.value.trim()
        if (!name || cell.column.options.includes(name) || names.includes(name)) {
          setStatus(multiStatus, name ? 'This option already exists.' : 'Enter an option name or remove the empty option.', true)
          input.focus()
          return
        }
        names.push(name)
        draft.querySelector('input[data-choice]').value = name
      }
    }
    const controls = [...multiForm.querySelectorAll('input, select, button')]
    savingMultiDialog = true
    controls.forEach((control) => { control.disabled = true })
    let optionsSaved = false
    let rowsCreated = false
    try {
      if (names.length) {
        setStatus(multiStatus, 'Saving options…')
        await Promise.all([...pendingWrites])
        const [response, payload] = await requestJson('PATCH',
          `${endpoint}/columns/${cell.column.id}`, {
            name: cell.column.name,
            options: [...cell.column.options, ...names],
          })
        if (!page.isConnected) return
        if (!response.ok) throw new Error(responseError(response, payload))
        cell.column.options = payload.options
        names.forEach((name) => cell.choiceLabels.set(name, name))
        optionsSaved = true
      }
      if (relatedValues.length) {
        setStatus(multiStatus, 'Adding related rows…')
        await Promise.all([...pendingWrites])
        const targetId = cell.column.relation_database_id
        const [response, payload] = await postJson(`/api/mdb/databases/${targetId}/rows/batch`, {
          column_id: cell.createColumn?.id ?? null,
          values: relatedValues,
        })
        if (!page.isConnected) return
        if (!response.ok) throw new Error(responseError(response, payload))
        const target = relatedDatabases.get(targetId)
        for (const [index, created] of payload.rows.entries()) {
          target.rows.push(created)
          cell.choiceLabels.set(created.id,
            rowLabel(created, target.columns, cell.column.relation_display_column_id))
          drafts[index].querySelector('input[data-choice]').value = String(created.id)
        }
        rowsCreated = true
      }
      const selectedChoices = [...multiOptions.querySelectorAll('input[data-choice]:checked')]
        .map((input) => cell.isRelation ? Number(input.value) : input.value)
      const selected = cell.isSingle ? (selectedChoices[0] ?? '') : selectedChoices
      multiCell = null
      multiDialog.close()
      cell.value = selected
      const write = saveCell(cell.button, cell.row.id, cell.column.id, selected, previous,
        (old) => { cell.value = old }, (saved) => { cell.value = saved })
      const saved = write ? await write : true
      if (optionsSaved || rowsCreated) {
        const refreshed = await refresh()
        if (refreshed && !write) notice.show(rowsCreated ? 'Related rows added.' : 'Options saved.')
      }
      if (!saved) return
    } catch (error) {
      if (optionsSaved || rowsCreated) await refresh()
      if (page.isConnected) {
        const message = error.message || 'Could not save choices.'
        if (multiDialog.open) setStatus(multiStatus, message, true)
        else notice.show(message, 'error')
      }
    } finally {
      savingMultiDialog = false
      controls.forEach((control) => { control.disabled = false })
    }
  })
  deleteDialog.addEventListener('cancel', (event) => {
    if (deleteConfirm.disabled) event.preventDefault()
  })
  deleteCancel.addEventListener('click', () => deleteDialog.close())
  deleteDialog.addEventListener('close', () => { deletingItem = null })
  deleteConfirm.addEventListener('click', async () => {
    if (!deletingItem || deleteConfirm.disabled) return
    const item = deletingItem
    deleteConfirm.disabled = true
    deleteCancel.disabled = true
    setStatus(deleteStatus, `Deleting ${item.kind === 'columns' ? 'column' : 'row'}…`)
    try {
      await Promise.all([...pendingWrites])
      const [response, payload] = await requestJson('DELETE', `${endpoint}/${item.kind}/${item.id}`)
      if (!page.isConnected) return
      if (!response.ok) throw new Error(responseError(response, payload))
      deleteDialog.close()
      const label = item.kind === 'columns' ? 'Column' : 'Row'
      if (await refresh()) notice.show(`${label} deleted.`)
      else notice.show(`${label} deleted, but the table could not refresh.`, 'warning')
    } catch (error) {
      if (page.isConnected) setStatus(deleteStatus, error.message || 'Could not delete item.', true)
    } finally {
      deleteConfirm.disabled = false
      deleteCancel.disabled = false
    }
  })
  async function createRow(button) {
    if (button.disabled) return
    button.disabled = true
    try {
      await Promise.all([...pendingWrites])
      const [response, payload] = await postJson(`${endpoint}/rows`, {})
      if (!page.isConnected) return
      if (!response.ok) throw new Error(responseError(response, payload))
      if (await refresh()) {
        notice.show('Row added.')
        const rows = tableArea.querySelectorAll('tbody tr.mdb-data-row')
        rows[rows.length - 1]?.querySelector('input')?.focus()
      }
    } catch (error) {
      if (page.isConnected) {
        setStatus(status, '')
        notice.show(error.message || 'Could not add row.', 'error')
      }
    } finally {
      button.disabled = false
    }
  }
  refresh()
}

startAuthApp({
  name: 'MDB',
  homeHref: '/mdb/',
  signupPrompt: 'New to MDB?',
  views: ['home', 'database'],
  links: [{ view: 'home', label: 'Databases' }],
  renderView(view, app, helpers) {
    if (view === 'home') renderDatabases(app, helpers)
    else if (view === 'database') renderDatabaseEditor(app, helpers)
    else return false
    return true
  },
})
