const displayValue = (value) => value === null ? '(empty)'
  : typeof value === 'string' ? value : JSON.stringify(value)

export function setupMdbSuggestions(page, { endpoint, requestJson, responseError, setStatus,
  notice, refresh, waitForWrites }) {
  const button = page.querySelector('#mdb-suggestions-button')
  const dialog = document.createElement('dialog')
  dialog.className = 'mdb-dialog mdb-suggestions-dialog'
  dialog.setAttribute('aria-labelledby', 'mdb-suggestions-title')
  dialog.innerHTML = `
    <div class="mdb-dialog-heading">
      <h2 id="mdb-suggestions-title">Suggestions</h2>
      <button class="mdb-dialog-delete" type="button" data-close aria-label="Close suggestions">×</button>
    </div>
    <p class="form-status" data-status role="status" aria-live="polite"></p>
    <div class="mdb-suggestions-layout">
      <div class="mdb-suggestions-list" data-list></div>
      <div class="mdb-suggestion-detail" data-detail>
        <p>Select a suggestion to review its changes.</p>
      </div>
    </div>
    <div class="dialog-actions mdb-suggestion-actions" data-actions hidden>
      <button class="auth-button auth-button-secondary" type="button" data-decline>Decline</button>
      <button class="auth-button auth-button-primary" type="button" data-accept>Accept changes</button>
    </div>`
  page.append(dialog)
  const status = dialog.querySelector('[data-status]')
  const list = dialog.querySelector('[data-list]')
  const detail = dialog.querySelector('[data-detail]')
  const actions = dialog.querySelector('[data-actions]')
  let suggestions = []
  let selectedId = null
  let loadingId = 0
  let busy = false

  function renderList() {
    list.replaceChildren()
    const pending = suggestions.filter((item) => item.status === 'pending').length
    button.textContent = pending ? `Suggestions (${pending})` : 'Suggestions'
    if (!suggestions.length) {
      list.textContent = 'No suggestions yet.'
      return
    }
    for (const item of suggestions) {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className = 'mdb-suggestion-entry'
      entry.classList.toggle('selected', item.id === selectedId)
      const title = document.createElement('strong')
      title.textContent = item.title
      const meta = document.createElement('span')
      meta.textContent = `${item.proposer} · ${item.change_count} change${item.change_count === 1 ? '' : 's'} · ${item.status}`
      entry.append(title, meta)
      entry.addEventListener('click', () => loadDetail(item.id))
      list.append(entry)
    }
  }

  async function loadList() {
    const [response, payload] = await requestJson('GET', `${endpoint}/suggestions`)
    if (!response.ok || !Array.isArray(payload?.suggestions)) {
      throw new Error(responseError(response, payload))
    }
    suggestions = payload.suggestions
    renderList()
  }

  async function loadDetail(id) {
    selectedId = id
    const generation = ++loadingId
    renderList()
    detail.textContent = 'Loading suggestion…'
    actions.hidden = true
    setStatus(status, '')
    try {
      const [response, payload] = await requestJson('GET', `${endpoint}/suggestions/${id}`)
      if (!dialog.isConnected || generation !== loadingId) return
      if (!response.ok || !payload?.suggestion || !Array.isArray(payload.changes)) {
        throw new Error(responseError(response, payload))
      }
      detail.replaceChildren()
      const heading = document.createElement('h3')
      heading.textContent = payload.suggestion.title
      const meta = document.createElement('p')
      meta.className = 'mdb-suggestion-meta'
      meta.textContent = `Proposed by ${payload.suggestion.proposer} · ${new Date(payload.suggestion.created).toLocaleString()}`
      detail.append(heading, meta)
      const hasDeletion = payload.changes.some((change) => change.kind === 'row_delete')
      const hasCreation = payload.changes.some((change) => change.kind === 'row_create')
      dialog.querySelector('[data-accept]').textContent = hasDeletion && hasCreation
        ? 'Accept row changes' : hasDeletion ? 'Accept and delete rows'
          : hasCreation ? 'Accept and create rows' : 'Accept changes'
      for (const change of payload.changes) {
        const card = document.createElement('section')
        card.className = 'mdb-suggestion-change'
        const name = document.createElement('h4')
        const rowName = change.kind === 'row_create' ? `New row ${change.item_index}`
          : change.row_position === null
          ? `Deleted row (ID ${change.row_id})`
          : `Row ${change.row_position}${change.row_label ? `: ${change.row_label}` : ''}`
        name.textContent = change.kind === 'row_delete'
          ? `${rowName} · Delete row` : change.kind === 'row_create'
            ? `${rowName} · Create row` : `${rowName} · ${change.column}`
        const values = document.createElement('div')
        values.className = 'mdb-suggestion-values'
        const current = change.kind === 'row_delete'
          ? change.fields.map((field) => `${field.column}: ${displayValue(field.value)}`).join('\n') || '(empty row)'
          : change.kind === 'row_create' ? '(new row)'
          : displayValue(change.before)
        const proposed = change.kind === 'row_delete' ? 'Delete this row'
          : change.kind === 'row_create'
            ? change.fields.map((field) => `${field.column}: ${displayValue(field.value)}`).join('\n')
            : displayValue(change.value)
        for (const [label, value] of [['Current', current], ['Proposed', proposed]]) {
          const cell = document.createElement('div')
          const caption = document.createElement('span')
          caption.textContent = label
          const content = document.createElement('p')
          content.textContent = value
          cell.append(caption, content)
          values.append(cell)
        }
        const reason = document.createElement('p')
        reason.className = 'mdb-suggestion-reason'
        reason.textContent = change.reason
        card.append(name, values, reason)
        if (change.kind === 'row_delete') {
          const warning = document.createElement('p')
          warning.className = 'mdb-suggestion-reason'
          warning.textContent = 'A row that is still referenced cannot be deleted.'
          card.append(warning)
        }
        detail.append(card)
      }
      actions.hidden = payload.suggestion.status !== 'pending'
    } catch (error) {
      if (dialog.isConnected) setStatus(status, error.message || 'Could not load suggestion.', true)
    }
  }

  async function decide(action) {
    if (busy || selectedId === null) return
    busy = true
    actions.querySelectorAll('button').forEach((item) => { item.disabled = true })
    setStatus(status, action === 'accept' ? 'Applying changes…' : 'Declining suggestion…')
    try {
      await waitForWrites()
      const [response, payload] = await requestJson('POST',
        `${endpoint}/suggestions/${selectedId}/${action}`, {})
      if (!response.ok) throw new Error(responseError(response, payload))
      await loadList()
      await loadDetail(selectedId)
      if (action === 'accept') await refresh()
      setStatus(status, '')
      notice.show(action === 'accept' ? 'Suggestion accepted.' : 'Suggestion declined.')
    } catch (error) {
      setStatus(status, error.message || 'Could not review suggestion.', true)
    } finally {
      busy = false
      actions.querySelectorAll('button').forEach((item) => { item.disabled = false })
    }
  }

  button.addEventListener('click', async () => {
    dialog.showModal()
    setStatus(status, 'Loading suggestions…')
    try {
      await loadList()
      setStatus(status, '')
      if (suggestions.length) await loadDetail(suggestions[0].id)
    } catch (error) {
      setStatus(status, error.message || 'Could not load suggestions.', true)
    }
  })
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close())
  dialog.querySelector('[data-accept]').addEventListener('click', () => decide('accept'))
  dialog.querySelector('[data-decline]').addEventListener('click', () => decide('decline'))
  loadList().catch(() => {})
}
