import { removeIcon } from '../../shared/icons.js'
import { optionPlaceholder } from './option-placeholder.js'

export function createColumnDialog({ page, endpoint, databaseId, requestJson, postJson,
  responseError, setStatus, notice, pendingWrites, refresh, openDeleteDialog,
  getDatabases, getRelatedDatabases }) {
  const dialog = page.querySelector('#mdb-column-dialog')
  const columnForm = page.querySelector('#mdb-column-form')
  const columnStatus = page.querySelector('#mdb-column-status')
  const columnOptions = page.querySelector('#mdb-column-options')
  const typeSelect = columnForm.elements.type
  const relationSelect = columnForm.elements.relation_database_id
  const displaySelect = columnForm.elements.relation_display_column_id
  let editingColumn = null
  let displayLoad = 0

  function openColumnDialog(column = null) {
    displayLoad++
    editingColumn = column
    columnForm.reset()
    columnForm.elements.name.value = column?.name ?? ''
    typeSelect.value = column?.type ?? 'text'
    renderColumnOptions(column?.options ?? [])
    relationSelect.replaceChildren()
    for (const database of getDatabases()) {
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
      let target = getRelatedDatabases().get(targetId)
      if (!target) {
        const [response, payload] = await requestJson('GET', `/api/mdb/databases/${targetId}?limit=1`)
        if (!response.ok) throw new Error(responseError(response, payload))
        target = payload
        getRelatedDatabases().set(targetId, target)
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
  return { openColumnDialog }
}
