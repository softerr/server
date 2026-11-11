export function createCsvController({ page, endpoint, requestJson, responseError, setStatus,
  notice, pendingWrites, exportButton, refresh, clearSearch, getCurrentTable,
  getRefreshGeneration, getSearchQuery, getActiveSort, getDatabases }) {
  const importButton = page.querySelector('#mdb-import-button')
  const importFileInput = page.querySelector('#mdb-import-file')
  const importDialog = page.querySelector('#mdb-import-dialog')
  const importForm = page.querySelector('#mdb-import-form')
  const importColumns = page.querySelector('#mdb-import-columns')
  const importStatus = page.querySelector('#mdb-import-status')
  let csvFile = null
  let importingCsv = false

  exportButton.addEventListener('click', async () => {
    if (exportButton.disabled || !getCurrentTable()) return
    const table = getCurrentTable()
    const generation = getRefreshGeneration()
    exportButton.disabled = true
    try {
      await Promise.all([...pendingWrites])
      if (!page.isConnected || generation !== getRefreshGeneration()) return
      const { database } = table
      const params = new URLSearchParams()
      if (getSearchQuery()) params.set('q', getSearchQuery())
      if (getActiveSort()) {
        params.set('sort_column_id', String(getActiveSort().columnId))
        params.set('direction', getActiveSort().direction)
      }
      const link = document.createElement('a')
      link.href = `${endpoint}/export.csv?${params}`
      link.download = `${database.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'database'}.csv`
      document.body.append(link)
      link.click()
      link.remove()
      notice.show('CSV download started.')
    } catch (error) {
      if (page.isConnected) notice.show(error.message || 'Could not export CSV.', 'error')
    } finally {
      if (page.isConnected && generation === getRefreshGeneration()) exportButton.disabled = false
    }
  })

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
      clearSearch()
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
    image: 'Image',
  }
  const importLookupTypes = new Set(['text', 'number', 'date', 'select'])
  const importDatabaseColumns = new Map()
  async function loadImportLookupColumns(databaseId) {
    if (importDatabaseColumns.has(databaseId)) return importDatabaseColumns.get(databaseId)
    const [response, payload] = await requestJson('GET', `/api/mdb/databases/${databaseId}?limit=1`)
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
    for (const database of getDatabases()) {
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
      if (preview.columns.some((column) => column.existing && column.type === 'image'
        && column.samples.length)) {
        throw new Error('CSV cannot import image cells. Remove the image column from the CSV and try again.')
      }
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

}
