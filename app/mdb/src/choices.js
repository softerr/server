import { optionPlaceholder } from './option-placeholder.js'
import { editIcon, removeIcon } from '@softerr/shared/icons.js'
import { parsePastedDate } from './date-parse.js'

export function createChoiceController({ page, endpoint, requestJson, postJson, responseError,
  setStatus, notice, pendingWrites, saveCell, refresh, getRelatedDatabases,
  getRelationChoiceCaches, getRelationRefreshes }) {
  const multiDialog = page.querySelector('#mdb-multi-dialog')
  const multiForm = page.querySelector('#mdb-multi-form')
  const multiOptions = page.querySelector('#mdb-multi-options')
  const relatedSearch = page.querySelector('#mdb-related-search')
  const relatedPages = page.querySelector('#mdb-related-pages')
  const relatedPrev = page.querySelector('#mdb-related-prev')
  const relatedNext = page.querySelector('#mdb-related-next')
  const relatedSummary = page.querySelector('#mdb-related-summary')
  const multiStatus = page.querySelector('#mdb-multi-status')
  let multiCell = null
  let relationSelection = new Set()
  let relationOffset = 0
  let relationTotal = 0
  let relationQuery = ''
  let relationRequest = 0
  let savingMultiDialog = false

  function appendChoiceOption(value, label, checked = false, single = false, editable = false) {
    const optionLabel = document.createElement(editable ? 'div' : 'label')
    optionLabel.className = editable ? 'mdb-option mdb-option-existing' : 'mdb-option'
    const choice = document.createElement('input')
    choice.type = single ? 'radio' : 'checkbox'
    if (single) choice.name = 'mdb-single-option'
    choice.dataset.choice = ''
    choice.value = String(value)
    if (editable) {
      optionLabel.dataset.original = String(value)
      const selectLabel = document.createElement('label')
      selectLabel.className = 'mdb-option-choice'
      const name = document.createElement('span')
      name.textContent = label
      selectLabel.append(choice, name)
      const rename = document.createElement('button')
      rename.type = 'button'
      rename.className = 'mdb-option-edit'
      rename.innerHTML = editIcon
      rename.setAttribute('aria-label', `Rename option ${label}`)
      rename.title = 'Rename option'
      rename.addEventListener('click', () => {
        const input = document.createElement('input')
        input.type = 'text'
        input.maxLength = 100
        input.value = label
        input.dataset.optionRename = ''
        input.setAttribute('aria-label', `New name for option ${label}`)
        name.hidden = true
        optionLabel.classList.add('is-renaming')
        choice.setAttribute('aria-label', label)
        optionLabel.insertBefore(input, rename)
        rename.hidden = true
        input.focus()
        input.select()
      })
      optionLabel.append(selectLabel, rename)
    } else {
      optionLabel.append(choice, document.createTextNode(label))
    }
    multiOptions.append(optionLabel)
    choice.checked = checked
    return optionLabel
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
    }, 'Add option', () => savingMultiDialog)
    multiOptions.append(placeholder)
  }

  function relatedRowValueColumn(column) {
    const target = getRelatedDatabases().get(column.relation_database_id)
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
      const choice = document.createElement('input')
      choice.type = multiCell.isSingle ? 'radio' : 'checkbox'
      if (multiCell.isSingle) choice.name = 'mdb-single-option'
      choice.dataset.choice = ''
      let editor = choice
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
        draft.append(choice, text)
      }
      if (valueColumn) draft.append(choice, editor)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'mdb-column-option-remove'
      remove.innerHTML = removeIcon
      remove.setAttribute('aria-label', 'Remove new row')
      remove.addEventListener('click', () => draft.remove())
      draft.append(remove)
      multiOptions.insertBefore(draft, placeholder)
      choice.checked = true
      return editor
    }, valueColumn ? 'Add related row' : 'Add blank row', () => savingMultiDialog)
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

  async function loadRelationChoices() {
    const cell = multiCell
    if (!cell?.isRelation) return
    const request = ++relationRequest
    setStatus(multiStatus, '')
    const params = new URLSearchParams({ limit: '50', offset: String(relationOffset),
      display_column_id: String(cell.column.relation_display_column_id ?? 0) })
    if (relationQuery) params.set('q', relationQuery)
    try {
      const [response, payload] = await requestJson('GET',
        `/api/mdb/databases/${cell.column.relation_database_id}/choices?${params}`)
      if (!multiDialog.open || cell !== multiCell || request !== relationRequest) return
      if (!response.ok) throw new Error(responseError(response, payload))
      relationTotal = payload.total_rows
      multiOptions.querySelectorAll('.mdb-relation-choice').forEach((item) => item.remove())
      const first = relationTotal === 0 ? 0 : relationOffset + 1
      relatedSummary.textContent = relationTotal === 0 ? '0 rows'
        : `${first}–${Math.min(relationOffset + 50, relationTotal)} of ${relationTotal}`
      relatedPages.querySelector('.mdb-page-arrows').hidden = relationTotal <= 50
      relatedPrev.disabled = relationOffset === 0
      relatedNext.disabled = payload.next_offset === null
      const anchor = multiOptions.querySelector('.mdb-option-draft, .mdb-option-placeholder')
      for (const item of payload.choices) {
        cell.choiceLabels.set(item.id, item.label)
        const option = appendChoiceOption(item.id, item.label, relationSelection.has(item.id), cell.isSingle)
        option.classList.add('mdb-relation-choice')
        if (anchor) multiOptions.insertBefore(option, anchor)
        const input = option.querySelector('input[data-choice]')
        input.addEventListener('change', () => {
          if (cell.isSingle) relationSelection.clear()
          if (input.checked) relationSelection.add(item.id)
          else relationSelection.delete(item.id)
        })
      }
    } catch (error) {
      if (multiDialog.open && cell === multiCell && request === relationRequest) {
        setStatus(multiStatus, error.message || 'Could not load related rows.', true)
      }
    }
  }
  let relationSearchTimer = null
  relatedSearch.addEventListener('input', () => {
    relationQuery = relatedSearch.value.trim()
    relationOffset = 0
    clearTimeout(relationSearchTimer)
    relationSearchTimer = setTimeout(loadRelationChoices, 250)
  })
  relatedPrev.addEventListener('click', () => { relationOffset -= 50; loadRelationChoices() })
  relatedNext.addEventListener('click', () => { relationOffset += 50; loadRelationChoices() })

  function addChoiceControl(td, row, column, related, label, value) {
    const isRelation = column.type === 'relation' || column.type === 'multi_relation'
    const isSingle = column.type === 'select' || column.type === 'relation'
    if (isRelation && !getRelationChoiceCaches().has(column.id)) {
      getRelationChoiceCaches().set(column.id, { choices: [], labels: new Map() })
    }
    const choicesForCell = () => isRelation ? getRelationChoiceCaches().get(column.id).choices
      : column.options.map((option) => [option, option])
    const choiceLabels = isRelation ? getRelationChoiceCaches().get(column.id).labels
      : new Map(choicesForCell())
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mdb-multi-button'
    let savedValue = isSingle ? (value ?? (isRelation ? null : '')) : (Array.isArray(value) ? value : [])
    const display = () => {
      if (isRelation && !related.has(column.relation_database_id)) {
        button.textContent = ''
        return
      }
      button.textContent = isSingle
        ? (isRelation
            ? (savedValue === null ? '' : choiceLabels.get(savedValue) ?? `Missing row ${savedValue}`)
            : savedValue)
        : savedValue.length
          ? savedValue.map((id) => choiceLabels.get(id)
            ?? (isRelation ? `Missing row ${id}` : id)).join(', ')
          : ''
    }
    button.setCellValue = (next) => { savedValue = next; display() }
    const refreshChoices = () => {
      button.disabled = isRelation && !related.has(column.relation_database_id)
      display()
    }
    if (isRelation) {
      const updates = getRelationRefreshes().get(column.relation_database_id) ?? []
      updates.push(refreshChoices)
      getRelationRefreshes().set(column.relation_database_id, updates)
    }
    refreshChoices()
    button.setAttribute('aria-label', label)
    button.addEventListener('click', () => {
      const choices = isRelation ? [] : choicesForCell()
      multiCell = { button, row, column, isRelation, isSingle, choiceLabels,
        get value() { return savedValue }, set value(next) { savedValue = next; display() } }
      page.querySelector('#mdb-multi-title').textContent = isRelation ? (isSingle ? 'Choose related row' : 'Choose related rows')
        : isSingle ? 'Choose option' : 'Select options'
      multiOptions.replaceChildren()
      setStatus(multiStatus, '')
      relatedSearch.hidden = !isRelation
      relatedPages.hidden = !isRelation
      relatedSearch.value = ''
      relationQuery = ''
      relationOffset = 0
      relationSelection = new Set(isRelation
        ? (isSingle ? (savedValue === null ? [] : [savedValue]) : savedValue) : [])
      if (isSingle) {
        const empty = appendChoiceOption('', isRelation ? 'No row' : 'No option',
        savedValue === (isRelation ? null : ''), true)
        if (isRelation) empty.querySelector('input').addEventListener('change', () => relationSelection.clear())
      }
      for (const [choiceValue, choiceLabel] of choices) {
        appendChoiceOption(choiceValue, choiceLabel,
          isSingle ? savedValue === choiceValue : savedValue.includes(choiceValue),
          isSingle, !isRelation)
      }
      if (isRelation) appendAddRelatedRowPlaceholder(column)
      else appendAddOptionPlaceholder()
      multiDialog.showModal()
      if (isRelation) loadRelationChoices()
    })
    td.append(button)
  }

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
    const renamedOptions = []
    const optionRenames = []
    const renameMap = new Map()
    if (!cell.isRelation) {
      for (const row of multiOptions.querySelectorAll('.mdb-option-existing')) {
        const original = row.dataset.original
        const input = row.querySelector('[data-option-rename]')
        const name = input ? input.value.trim() : original
        if (!name || renamedOptions.includes(name)) {
          setStatus(multiStatus, name ? 'Options must be unique.' : 'Enter an option name.', true)
          input?.focus()
          return
        }
        renamedOptions.push(name)
        if (name !== original) {
          optionRenames.push({ from: original, to: name })
          renameMap.set(original, name)
        }
      }
    }
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
        if (!name || renamedOptions.includes(name) || names.includes(name)) {
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
      if (names.length || optionRenames.length) {
        setStatus(multiStatus, 'Saving options…')
        await Promise.all([...pendingWrites])
        const [response, payload] = await requestJson('PATCH',
          `${endpoint}/columns/${cell.column.id}`, {
            name: cell.column.name,
            options: [...renamedOptions, ...names],
            option_renames: optionRenames,
          })
        if (!page.isConnected) return
        if (!response.ok) throw new Error(responseError(response, payload))
        cell.column.options = payload.options
        cell.choiceLabels.clear()
        for (const option of payload.options) cell.choiceLabels.set(option, option)
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
        const target = getRelatedDatabases().get(targetId)
        for (const [index, created] of payload.rows.entries()) {
          target.rows.push(created)
          cell.choiceLabels.set(created.id,
            rowLabel(created, target.columns, cell.column.relation_display_column_id))
          drafts[index].querySelector('input[data-choice]').value = String(created.id)
        }
        rowsCreated = true
      }
      const selectedChoices = cell.isRelation
        ? [...relationSelection, ...[...multiOptions.querySelectorAll('.mdb-option-draft input[data-choice]:checked')]
          .map((input) => Number(input.value))]
        : [...multiOptions.querySelectorAll('input[data-choice]:checked')]
          .map((input) => renameMap.get(input.value) ?? input.value)
      if (cell.isRelation && cell.isSingle) {
        const draft = multiOptions.querySelector('.mdb-option-draft input[data-choice]:checked')
        if (draft) selectedChoices.splice(0, selectedChoices.length, Number(draft.value))
        else if (multiOptions.querySelector('.mdb-option:not(.mdb-relation-choice) input[data-choice]:checked')) {
          selectedChoices.splice(0)
        }
      }
      const selected = cell.isSingle ? (selectedChoices[0] ?? (cell.isRelation ? null : '')) : selectedChoices
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
  return { addChoiceControl }
}
