import './style.css'
import { startAuthApp } from '../../shared/auth-app.js'
import { createPageNotice } from '../../shared/page-notice.js'
import { removeIcon, deleteIcon } from '../../shared/icons.js'
import { setupMdbSuggestions } from './suggestions.js'
import { renderDatabases } from './library.js'
import { createImagePicker } from './image-picker.js'
import { createOrderingController } from './ordering.js'
import { createCsvController } from './csv.js'
import { createChoiceController } from './choices.js'
import { createTableController } from './table.js'
import { createColumnDialog } from './column-dialog.js'
import { createDeleteDialog } from './delete-dialog.js'

const pageArrowIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>`
const importCsvIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/>
</svg>`
const exportCsvIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 16V4m-4 4 4-4 4 4M4 17v3h16v-3"/>
</svg>`
const suggestionsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 11.5c0 4.2-3.6 7.5-8 7.5-1.1 0-2.1-.2-3-.6L4 20l1.1-4.1A7.2 7.2 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z"/>
  <path d="M8.5 10h7M8.5 13h5"/>
</svg>`

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
        <div class="mdb-editor-actions">
          <label class="mdb-editor-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>
            <input id="mdb-row-search" type="search" aria-label="Search rows" placeholder="Search rows" autocomplete="off" />
          </label>
          <button id="mdb-import-button" class="auth-button auth-button-secondary mdb-editor-tool" type="button" aria-label="Import CSV" title="Import CSV">${importCsvIcon}</button>
          <button id="mdb-export-button" class="auth-button auth-button-secondary mdb-editor-tool" type="button" aria-label="Export CSV" title="Export CSV" disabled>${exportCsvIcon}</button>
          <button id="mdb-suggestions-button" class="auth-button auth-button-secondary mdb-editor-tool" type="button" aria-label="Suggestions" title="Suggestions">${suggestionsIcon}<span class="mdb-suggestions-count" aria-hidden="true" hidden></span></button>
          <div class="mdb-header-pager">
            <label class="mdb-page-size">Rows
              <select id="mdb-page-size" aria-label="Rows per page">
                <option value="25">25</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="all">All</option>
              </select>
            </label>
            <nav class="mdb-table-pager" aria-label="Table pages">
              <span id="mdb-page-summary" class="mdb-page-summary" aria-live="polite"></span>
              <div id="mdb-page-arrows" class="mdb-page-arrows">
                <button id="mdb-page-prev" class="mdb-page-arrow" type="button" aria-label="Previous page" title="Previous page">${pageArrowIcon}</button>
                <button id="mdb-page-next" class="mdb-page-arrow is-next" type="button" aria-label="Next page" title="Next page">${pageArrowIcon}</button>
              </div>
            </nav>
          </div>
          <input id="mdb-import-file" type="file" accept=".csv,text/csv" hidden />
        </div>
      </header>
      <p id="mdb-editor-status" class="form-status" role="status" aria-live="polite"></p>
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
          <option value="date">Date</option><option value="checkbox">Checkbox</option><option value="image">Image</option>
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
        <input id="mdb-related-search" type="search" aria-label="Search related rows" placeholder="Search related rows" autocomplete="off" hidden />
        <div id="mdb-multi-options" class="mdb-option-list"></div>
        <nav id="mdb-related-pages" class="mdb-table-pager mdb-related-pages" aria-label="Related row pages" hidden>
          <span id="mdb-related-summary" class="mdb-page-summary" aria-live="polite"></span>
          <div class="mdb-page-arrows">
            <button id="mdb-related-prev" class="mdb-page-arrow" type="button" aria-label="Previous related rows page" title="Previous page">${pageArrowIcon}</button>
            <button id="mdb-related-next" class="mdb-page-arrow is-next" type="button" aria-label="Next related rows page" title="Next page">${pageArrowIcon}</button>
          </div>
        </nav>
        <p id="mdb-multi-status" class="form-status" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button id="mdb-multi-cancel" class="auth-button auth-button-secondary" type="button">Cancel</button>
          <button class="auth-button auth-button-primary" type="submit">Save</button>
        </div>
      </form>
    </dialog>
    <dialog id="mdb-image-dialog" class="mdb-dialog mdb-image-dialog" aria-labelledby="mdb-image-title">
      <div class="mdb-image-heading">
        <h2 id="mdb-image-title">Choose image</h2>
        <button id="mdb-image-close" type="button" aria-label="Close image picker" title="Close">${removeIcon}</button>
      </div>
      <input id="mdb-image-search" type="search" aria-label="Search images" placeholder="Search images" autocomplete="off" />
      <input id="mdb-image-upload" type="file" accept="image/png,image/jpeg,image/webp" hidden />
      <div id="mdb-image-grid" class="mdb-image-grid"></div>
      <p id="mdb-image-status" class="form-status" role="status" aria-live="polite"></p>
    </dialog>
    <dialog id="mdb-delete-dialog" class="mdb-dialog mdb-delete-dialog" aria-labelledby="mdb-delete-title">
      <h2 id="mdb-delete-title"></h2>
      <p id="mdb-delete-description"></p>
      <div id="mdb-delete-usage" class="mdb-delete-usage" hidden>
        <p id="mdb-delete-usage-summary"></p>
        <ul id="mdb-delete-usage-list"></ul>
      </div>
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
  const searchInput = page.querySelector('#mdb-row-search')
  const tableArea = page.querySelector('#mdb-table-area')
  const pageSizeSelect = page.querySelector('#mdb-page-size')
  const pageSizeStorageKey = 'mdb.rowsPerPage'
  try {
    const savedPageSize = window.localStorage.getItem(pageSizeStorageKey)
    if ([...pageSizeSelect.options].some((option) => option.value === savedPageSize)) {
      pageSizeSelect.value = savedPageSize
    }
  } catch { /* Storage may be unavailable; the default page size still works. */ }
  const pagePrev = page.querySelector('#mdb-page-prev')
  const pageNext = page.querySelector('#mdb-page-next')
  const pageArrows = page.querySelector('#mdb-page-arrows')
  const pageSummary = page.querySelector('#mdb-page-summary')
  const exportButton = page.querySelector('#mdb-export-button')
  const pendingWrites = new Set()
  let databases = []
  let relatedDatabases = new Map()
  let relationRefreshes = new Map()
  let relationChoiceCaches = new Map()
  let refreshGeneration = 0
  let rowsReady = Promise.resolve()
  let activeSort = null
  let searchQuery = ''
  let pageOffset = 0
  let pageSize = pageSizeSelect.value === 'all' ? null : Number(pageSizeSelect.value)
  let pageTotal = 0
  let loadedRows = 0
  let allRowsLoading = false
  let currentTable = null

  let searchTimer = null
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim()
    pageOffset = 0
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => refresh(), 250)
  })
  function clearSearch() {
    if (searchInput.value === '') return
    searchInput.value = ''
    searchQuery = ''
    pageOffset = 0
    refresh()
  }
  pageSizeSelect.addEventListener('change', () => {
    pageSize = pageSizeSelect.value === 'all' ? null : Number(pageSizeSelect.value)
    try { window.localStorage.setItem(pageSizeStorageKey, pageSizeSelect.value) } catch { /* Keep this choice for the current page. */ }
    pageOffset = 0
    refresh()
  })
  pagePrev.addEventListener('click', () => {
    if (pageSize === null) return
    pageOffset = Math.max(0, pageOffset - pageSize)
    refresh()
  })
  pageNext.addEventListener('click', () => {
    if (pageSize === null) return
    pageOffset += pageSize
    refresh()
  })
  function updatePageControls() {
    const first = pageTotal === 0 ? 0 : pageOffset + 1
    const last = Math.min(pageOffset + (pageSize ?? loadedRows), pageTotal)
    pageSummary.textContent = pageTotal === 0 ? '0 rows' : `${first}–${last} of ${pageTotal}`
    pageArrows.hidden = pageSize === null || pageTotal <= pageSize
    pagePrev.disabled = pageSize === null || pageOffset === 0
    pageNext.disabled = pageSize === null || pageOffset + pageSize >= pageTotal
  }

  const { dragHandle, dropTarget } = createOrderingController({
    page, tableArea, endpoint, requestJson, responseError, setStatus, status, notice, pendingWrites,
    refresh, rowsCannotReorder: () => allRowsLoading || activeSort !== null || searchQuery !== '',
    getPageSize: () => pageSize, getPageOffset: () => pageOffset,
  })

  function saveCell(control, rowId, columnId, value, previous, restore, saved) {
    if (JSON.stringify(value) === JSON.stringify(previous)) return null
    control.disabled = true
    notice.show('Saving cell…', 'info')
    const write = requestJson('PUT', `${endpoint}/rows/${rowId}/cells/${columnId}`, { value })
      .then(([response, payload]) => {
        if (!page.isConnected) return
        if (!response.ok) throw new Error(responseError(response, payload))
        saved(payload.value)
        const row = currentTable?.rows.get(rowId)
        if (row) row.values[columnId] = payload.value
        if (activeSort?.columnId === columnId || searchQuery !== '') refresh()
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

  const { addChoiceControl } = createChoiceController({ page, endpoint, requestJson, postJson,
    responseError, setStatus, notice, pendingWrites, saveCell, refresh,
    getRelatedDatabases: () => relatedDatabases,
    getRelationChoiceCaches: () => relationChoiceCaches,
    getRelationRefreshes: () => relationRefreshes })
  const { openImageDialog } = createImagePicker({ page, requestJson, responseError, setStatus, notice, saveCell })

  const { openDeleteDialog } = createDeleteDialog({ page, endpoint, requestJson, responseError,
    setStatus, notice, pendingWrites, refresh, getRowsReady: () => rowsReady })
  const { openColumnDialog } = createColumnDialog({ page, endpoint, databaseId, requestJson,
    postJson, responseError, setStatus, notice, pendingWrites, refresh, openDeleteDialog,
    getDatabases: () => databases, getRelatedDatabases: () => relatedDatabases })
  const { showTable } = createTableController({ page, endpoint, requestJson, responseError, notice,
    pendingWrites, tableArea, title, saveCell, openImageDialog, addChoiceControl,
    dragHandle, dropTarget, openColumnDialog, openDeleteDialog, createRow, refresh,
    getActiveSort: () => activeSort, setActiveSort: (next) => { activeSort = next },
    getSearchQuery: () => searchQuery, getAllRowsLoading: () => allRowsLoading,
    setPageOffset: (next) => { pageOffset = next },
    resetRelationCaches: () => { relationRefreshes = new Map(); relationChoiceCaches = new Map() },
  })

  async function refresh() {
    const generation = ++refreshGeneration
    exportButton.disabled = true
    setStatus(status, '')
    try {
      const parameters = new URLSearchParams({ limit: String(pageSize ?? 50), offset: String(pageOffset) })
      if (searchQuery) parameters.set('q', searchQuery)
      if (activeSort) {
        parameters.set('sort_column_id', String(activeSort.columnId))
        parameters.set('direction', activeSort.direction)
      }
      const [[response, payload], [listResponse, listPayload]] = await Promise.all([
        requestJson('GET', `${endpoint}?${parameters}`), requestJson('GET', '/api/mdb/databases'),
      ])
      if (!page.isConnected || generation !== refreshGeneration) return false
      if (response.status === 400 && payload?.error === 'Invalid sort column' && activeSort) {
        activeSort = null
        pageOffset = 0
        return refresh()
      }
      if (!response.ok) throw new Error(responseError(response, payload))
      if (!listResponse.ok) throw new Error(responseError(listResponse, listPayload))
      databases = listPayload.databases
      if (pageSize !== null && pageOffset > 0 && payload.total_rows <= pageOffset) {
        pageOffset = Math.max(0, Math.ceil(payload.total_rows / pageSize) - 1) * pageSize
        return refresh()
      }
      pageTotal = payload.total_rows
      loadedRows = payload.rows.length
      allRowsLoading = pageSize === null && loadedRows < pageTotal
      updatePageControls()
      const related = new Map()
      relatedDatabases = related
      const table = showTable(payload, related)
      currentTable = table
      const relatedIds = [...new Set(payload.columns.filter((column) => ['relation', 'multi_relation'].includes(column.type))
        .map((column) => column.relation_database_id))]
      const metadataReady = Promise.all(relatedIds.map(async (id) => {
        const target = id === databaseId ? payload : await (async () => {
          const [relatedResponse, relatedPayload] = await requestJson('GET',
            `/api/mdb/databases/${id}?limit=1`)
          if (!relatedResponse.ok) throw new Error(responseError(relatedResponse, relatedPayload))
          return relatedPayload
        })()
        if (!page.isConnected || generation !== refreshGeneration) return
        related.set(id, target)
      }))
      async function loadRelationLabels(rows, refreshStart = new Map()) {
        if (!page.isConnected || generation !== refreshGeneration) return
        await Promise.all(relatedIds.map(async (id) => {
          for (const column of payload.columns.filter((item) => item.relation_database_id === id)) {
            const ids = [...new Set(rows.flatMap((row) => {
              const value = row.values?.[column.id]
              return Array.isArray(value) ? value : value == null ? [] : [value]
            }))]
            const cache = relationChoiceCaches.get(column.id)
            if (!cache || !ids.length) continue
            for (let offset = 0; offset < ids.length; offset += 100) {
              const selected = ids.slice(offset, offset + 100)
              const params = new URLSearchParams({ ids: selected.join(','),
                display_column_id: String(column.relation_display_column_id ?? 0) })
              const [choiceResponse, choicePayload] = await requestJson('GET',
                `/api/mdb/databases/${id}/choices?${params}`)
              if (!choiceResponse.ok) throw new Error(responseError(choiceResponse, choicePayload))
              if (!page.isConnected || generation !== refreshGeneration) return
              for (const choice of choicePayload.choices) cache.labels.set(choice.id, choice.label)
            }
          }
          if (!page.isConnected || generation !== refreshGeneration) return
          for (const update of (relationRefreshes.get(id) ?? []).slice(refreshStart.get(id) ?? 0)) update()
        }))
      }
      rowsReady = metadataReady.then(() => loadRelationLabels(payload.rows))
      const results = await Promise.allSettled([rowsReady])
      if (!page.isConnected || generation !== refreshGeneration) return false
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason
      }
      setStatus(status, '')
      exportButton.disabled = payload.columns.length === 0
      exportButton.title = payload.columns.length === 0
        ? 'Add a column before exporting CSV' : 'Export CSV'
      if (allRowsLoading) {
        void (async () => {
          try {
            while (loadedRows < pageTotal) {
              if (!page.isConnected || generation !== refreshGeneration) return
              const nextParameters = new URLSearchParams(parameters)
              nextParameters.set('limit', '200')
              nextParameters.set('offset', String(loadedRows))
              const [nextResponse, nextPayload] = await requestJson('GET', `${endpoint}?${nextParameters}`)
              if (!page.isConnected || generation !== refreshGeneration) return
              if (!nextResponse.ok) throw new Error(responseError(nextResponse, nextPayload))
              if (!Array.isArray(nextPayload?.rows) || nextPayload.rows.length === 0
                || nextPayload.total_rows !== pageTotal
                || nextPayload.rows.some((row) => table.rows.has(row.id))) {
                throw new Error('Database rows changed while loading. Reload to try again.')
              }
              const refreshStart = new Map(relatedIds.map((id) => [id,
                relationRefreshes.get(id)?.length ?? 0]))
              table.appendPage(nextPayload.rows)
              loadedRows += nextPayload.rows.length
              updatePageControls()
              await loadRelationLabels(nextPayload.rows, refreshStart)
            }
            if (!page.isConnected || generation !== refreshGeneration) return
            allRowsLoading = false
            table.updateRowDragHandles()
          } catch (error) {
            if (page.isConnected && generation === refreshGeneration) {
              setStatus(status, error.message || 'Could not load all rows.', true)
            }
          }
        })()
      }
      return true
    } catch (error) {
      if (page.isConnected && generation === refreshGeneration) {
        setStatus(status, error.message || 'Could not load database.', true)
      }
      return false
    }
  }

  createCsvController({ page, endpoint, requestJson, responseError, setStatus, notice, pendingWrites,
    exportButton, refresh, clearSearch, getCurrentTable: () => currentTable,
    getRefreshGeneration: () => refreshGeneration, getSearchQuery: () => searchQuery,
    getActiveSort: () => activeSort, getDatabases: () => databases })

  async function createRow(button) {
    if (button.disabled) return
    button.disabled = true
    try {
      await rowsReady
      if (!button.isConnected) return
      await Promise.all([...pendingWrites])
      const [response, payload] = await postJson(`${endpoint}/rows`, {})
      if (!page.isConnected) return
      if (!response.ok) throw new Error(responseError(response, payload))
      searchInput.value = ''
      searchQuery = ''
      activeSort = null
      pageOffset = pageSize === null ? 0 : Math.floor((payload.position - 1) / pageSize) * pageSize
      if (await refresh()) {
        notice.show('Row added.')
        tableArea.querySelector(`tbody tr.mdb-data-row[data-row-id="${payload.id}"]`)
          ?.querySelector('.mdb-cell-control, .mdb-multi-button')?.focus()
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
  setupMdbSuggestions(page, { endpoint, requestJson, responseError, setStatus, notice,
    refresh, waitForWrites: () => Promise.all([...pendingWrites]) })
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
