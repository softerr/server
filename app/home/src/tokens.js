import { editIcon } from '@softerr/shared/icons.js'

const activityIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
const revokeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>'

const dateLabel = (value) => value ? new Date(value).toLocaleString() : 'Never'
const expired = (token) => token.expires !== null && new Date(token.expires) <= new Date()

export function renderTokens(app, { requestJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="tokens-page">
      <div class="tokens-heading">
        <h1 class="section-title">API tokens</h1>
        <button type="button" class="auth-button auth-button-primary" data-create disabled>Create token</button>
      </div>
      <p class="tokens-description">Each token has its own service account. Its name identifies actions made with that token.</p>
      <p class="form-status" data-status role="status" aria-live="polite">Loading tokens…</p>
      <div class="tokens-table-wrap" data-table hidden>
        <table class="tokens-table"><thead data-head></thead><tbody data-body></tbody></table>
      </div>
      <dialog class="user-dialog token-dialog" data-create-dialog aria-labelledby="create-token-title">
        <h2 id="create-token-title">Create API token</h2>
        <form data-form>
          <label class="field"><span>Name</span><input name="name" maxlength="100" required placeholder="Automation name"></label>
          <p class="token-access-description">A token can have its own quizzes, playlists, and databases, separate from yours. Choose which data it can use.</p>
          <div class="token-app-access" data-create-access></div>
          <fieldset class="token-scopes"><legend>Media permissions</legend><div data-media-scopes></div></fieldset>
          <label class="field"><span>Expires after</span><select name="expires_in_days">
            <option value="7">7 days</option><option value="30" selected>30 days</option>
            <option value="90">90 days</option><option value="365">365 days</option>
            <option value="never">Never</option>
          </select></label>
          <p class="form-status" data-create-status role="status" aria-live="polite"></p>
          <div class="user-dialog-actions">
            <button type="button" class="auth-button auth-button-secondary" data-cancel-create>Cancel</button>
            <button type="submit" class="auth-button auth-button-primary">Create token</button>
          </div>
        </form>
      </dialog>
      <dialog class="user-dialog token-dialog" data-access-dialog aria-labelledby="token-access-title">
        <h2 id="token-access-title">App access</h2>
        <div class="token-app-access" data-edit-access></div>
        <p class="form-status" data-access-status role="status" aria-live="polite"></p>
        <div class="user-dialog-actions">
          <button type="button" class="auth-button auth-button-secondary" data-cancel-access>Cancel</button>
          <button type="button" class="auth-button auth-button-primary" data-save-access>Save access</button>
        </div>
      </dialog>
      <dialog class="user-dialog token-dialog" data-reveal-dialog aria-labelledby="reveal-token-title">
        <h2 id="reveal-token-title">Copy API token</h2>
        <div class="token-reveal-content">
          <p>Copy this token now. It will not be shown again.</p>
          <label class="field"><span>Token</span><input data-revealed-token readonly></label>
          <p class="form-status" data-copy-status role="status" aria-live="polite"></p>
        </div>
        <div class="user-dialog-actions">
          <button type="button" class="auth-button auth-button-secondary" data-copy>Copy</button>
          <button type="button" class="auth-button auth-button-primary" data-done>Done</button>
        </div>
      </dialog>
      <dialog class="user-dialog token-dialog" data-activity-dialog aria-labelledby="token-activity-title">
        <h2 id="token-activity-title">Recent token actions</h2>
        <div class="token-activity-content">
          <p class="form-status" data-activity-status role="status"></p>
          <div class="tokens-table-wrap"><table class="tokens-table">
            <thead><tr><th>When</th><th>Method</th><th>Path</th><th>Status</th></tr></thead>
            <tbody data-activity-body></tbody>
          </table></div>
        </div>
        <div class="user-dialog-actions"><button type="button" class="auth-button auth-button-primary" data-close-activity>Close</button></div>
      </dialog>
    </main>`

  const status = page.querySelector('[data-status]')
  const form = page.querySelector('[data-form]')
  const createDialog = page.querySelector('[data-create-dialog]')
  const accessDialog = page.querySelector('[data-access-dialog]')
  const revealDialog = page.querySelector('[data-reveal-dialog]')
  const activityDialog = page.querySelector('[data-activity-dialog]')
  const body = page.querySelector('[data-body]')
  let apps = []
  let tokens = []
  let editingToken = null
  let busy = false
  const scopes = (access) => [
    ...apps.flatMap((entry) => {
      const section = form.querySelector(`[data-app="${entry.id}"]`)
      const mode = section.querySelector('[data-mode]').value
      const grant = access[entry.id]
      const read = mode === 'service-read' || mode === 'service-edit'
        || grant.all !== 'none' || grant.resources.length > 0
      const edit = mode === 'service-edit' || grant.all === 'edit'
        || grant.resources.some((resource) => resource.permission === 'edit')
      return read ? [entry.read_scope, ...(edit ? [entry.write_scope] : [])] : []
    }),
    ...[...form.querySelectorAll('[name="scope"]:checked')].map((input) => input.value),
  ]
  const emptyAccess = () => Object.fromEntries(apps.map(({ id }) => [id, { all: 'none', resources: [] }]))

  function collectAccess(container) {
    const access = {}
    for (const entry of apps) {
      const section = [...container.querySelectorAll('[data-app]')].find((item) => item.dataset.app === entry.id)
      const mode = section.querySelector('[data-mode]').value
      access[entry.id] = {
        all: mode === 'selected' || mode.startsWith('service-') ? 'none' : mode,
        resources: mode === 'selected'
          ? [...section.querySelectorAll('[data-resource]')]
            .filter((select) => select.value !== 'none')
            .map((select) => ({ id: Number(select.dataset.resource), permission: select.value }))
          : [],
      }
    }
    return access
  }

  function renderAccess(container, access, choosePermissions = false) {
    container.replaceChildren()
    for (const entry of apps) {
      const grant = access?.[entry.id] ?? { all: 'none', resources: [] }
      const section = document.createElement('section')
      section.dataset.app = entry.id
      const label = document.createElement('label')
      label.className = 'field'
      const title = document.createElement('span')
      title.textContent = choosePermissions ? `${entry.name} access` : `My ${entry.resource}`
      const mode = document.createElement('select')
      mode.dataset.mode = ''
      const choices = [['none', 'No access']]
      if (choosePermissions) choices.push(['service-read', 'This token’s own data · read'],
        ['service-edit', 'This token’s own data · edit'])
      choices.push(['selected', `Selected ${entry.resource}`],
        ['read', `All my ${entry.resource} · read`], ['edit', `All my ${entry.resource} · edit`])
      for (const [value, text] of choices) {
        mode.add(new Option(text, value))
      }
      mode.value = grant.all === 'none' && grant.resources.length ? 'selected' : grant.all
      label.append(title, mode)
      section.append(label)
      const list = document.createElement('div')
      list.className = 'token-resource-list'
      const selected = new Map(grant.resources.map((resource) => [resource.id, resource.permission]))
      for (const resource of entry.resources) {
        const row = document.createElement('label')
        const name = document.createElement('span')
        name.textContent = resource.name
        const permission = document.createElement('select')
        permission.dataset.resource = String(resource.id)
        for (const value of ['none', 'read', 'edit']) permission.add(new Option(value === 'none' ? 'No access' : value, value))
        permission.value = selected.get(resource.id) ?? 'none'
        row.append(name, permission)
        list.append(row)
      }
      if (!entry.resources.length) list.textContent = `No ${entry.resource} in your library.`
      section.append(list)
      const update = () => { list.hidden = mode.value !== 'selected' }
      mode.addEventListener('change', update)
      update()
      container.append(section)
    }
  }

  function accessLabel(grant) {
    if (grant?.all === 'read') return 'All · read'
    if (grant?.all === 'edit') return 'All · edit'
    return grant?.resources?.length ? `${grant.resources.length} selected` : 'None'
  }

  function renderRows() {
    const head = page.querySelector('[data-head]')
    head.replaceChildren()
    const headings = document.createElement('tr')
    for (const name of ['Service account', 'Permissions', ...apps.map((entry) => `My ${entry.resource}`),
      'Expires', 'Last used', 'Status', '']) {
      const cell = document.createElement('th')
      cell.textContent = name
      headings.append(cell)
    }
    head.append(headings)
    body.replaceChildren()
    for (const token of tokens) {
      const row = document.createElement('tr')
      for (const value of [`${token.username} · #${token.user_id}`, token.scopes.join(', '),
        ...apps.map((entry) => accessLabel(token.access?.[entry.id])),
        dateLabel(token.expires), dateLabel(token.last_used_at),
        token.revoked_at ? 'Revoked' : expired(token) ? 'Expired' : 'Active']) {
        const cell = document.createElement('td')
        cell.textContent = value
        row.append(cell)
      }
      const actions = document.createElement('td')
      const actionGroup = document.createElement('div')
      actionGroup.className = 'token-row-actions'
      actions.append(actionGroup)
      const activity = document.createElement('button')
      activity.type = 'button'
      activity.className = 'token-action-button'
      activity.innerHTML = activityIcon
      activity.setAttribute('aria-label', `Activity for ${token.name}`)
      activity.title = 'Activity'
      activity.addEventListener('click', async () => {
        const content = page.querySelector('[data-activity-body]')
        const activityStatus = page.querySelector('[data-activity-status]')
        content.replaceChildren()
        activityDialog.querySelector('h2').textContent = `${token.username} actions`
        setStatus(activityStatus, 'Loading…')
        activityDialog.showModal()
        try {
          const [response, payload] = await requestJson('GET', `/api/auth/tokens/${token.id}/activity`)
          if (!response.ok || !Array.isArray(payload?.activity)) {
            setStatus(activityStatus, responseError(response, payload), true)
            return
          }
          setStatus(activityStatus, payload.activity.length ? '' : 'No actions recorded yet.')
          for (const entry of payload.activity) {
            const actionRow = document.createElement('tr')
            for (const value of [dateLabel(entry.created), entry.method, entry.path, entry.status]) {
              const cell = document.createElement('td')
              cell.textContent = String(value)
              actionRow.append(cell)
            }
            content.append(actionRow)
          }
        } catch { setStatus(activityStatus, 'Could not load token activity.', true) }
      })
      actionGroup.append(activity)
      if (!token.revoked_at && !expired(token)) {
        const edit = document.createElement('button')
        edit.type = 'button'
        edit.className = 'token-action-button'
        edit.innerHTML = editIcon
        edit.setAttribute('aria-label', `Edit access for ${token.name}`)
        edit.title = 'Access'
        edit.addEventListener('click', () => {
          editingToken = token
          renderAccess(page.querySelector('[data-edit-access]'), token.access)
          setStatus(page.querySelector('[data-access-status]'), '')
          accessDialog.showModal()
        })
        actionGroup.append(edit)
        const revoke = document.createElement('button')
        revoke.type = 'button'
        revoke.className = 'token-action-button'
        revoke.innerHTML = revokeIcon
        revoke.setAttribute('aria-label', `Revoke ${token.name}`)
        revoke.title = 'Revoke'
        revoke.addEventListener('click', async () => {
          if (!window.confirm(`Revoke ${token.name}?`)) return
          revoke.disabled = true
          try {
            const [response, payload] = await requestJson('DELETE', `/api/auth/tokens/${token.id}`)
            if (!response.ok) { setStatus(status, responseError(response, payload), true); revoke.disabled = false; return }
            token.revoked_at = new Date().toISOString()
            renderRows()
            setStatus(status, 'Token revoked.', false, true)
          } catch { setStatus(status, 'Could not revoke token.', true); revoke.disabled = false }
        })
        actionGroup.append(revoke)
      }
      row.append(actions)
      body.append(row)
    }
    page.querySelector('[data-table]').hidden = tokens.length === 0
    if (!tokens.length) setStatus(status, 'No API tokens yet.')
  }

  Promise.all([requestJson('GET', '/api/auth/tokens'), requestJson('GET', '/api/auth/token-capabilities')])
    .then(([[tokenResponse, tokenData], [capResponse, capData]]) => {
      if (!page.isConnected) return
      if (!tokenResponse.ok || !Array.isArray(tokenData?.tokens)
        || !capResponse.ok || !Array.isArray(capData?.apps)) {
        setStatus(status, 'Could not load API token settings.', true)
        return
      }
      apps = capData.apps
      tokens = tokenData.tokens
      const scopeChoices = form.querySelector('[data-media-scopes]')
      for (const [scope, label] of (capData.extra_scopes ?? []).map((entry) => [entry.id, entry.label])) {
        const row = document.createElement('label')
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.name = 'scope'
        checkbox.value = scope
        const caption = document.createElement('span')
        caption.textContent = label
        row.append(checkbox, caption)
        scopeChoices.append(row)
      }
      page.querySelector('[data-create]').disabled = false
      setStatus(status, '')
      renderRows()
    }).catch(() => { if (page.isConnected) setStatus(status, 'Could not load API tokens.', true) })

  page.querySelector('[data-create]').addEventListener('click', () => {
    form.reset()
    renderAccess(page.querySelector('[data-create-access]'), emptyAccess(), true)
    setStatus(page.querySelector('[data-create-status]'), '')
    createDialog.showModal()
    form.elements.name.focus()
  })
  page.querySelector('[data-cancel-create]').addEventListener('click', () => createDialog.close())
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    const createStatus = page.querySelector('[data-create-status]')
    const accessContainer = page.querySelector('[data-create-access]')
    const access = collectAccess(accessContainer)
    const emptySelection = apps.find((entry) => {
      const section = [...accessContainer.querySelectorAll('[data-app]')]
        .find((item) => item.dataset.app === entry.id)
      return section.querySelector('[data-mode]').value === 'selected'
        && access[entry.id].resources.length === 0
    })
    if (emptySelection) {
      setStatus(createStatus, `Select at least one ${emptySelection.name} item.`, true)
      return
    }
    const selectedScopes = scopes(access)
    if (!selectedScopes.length) { setStatus(createStatus, 'Choose an app or media permission.', true); return }
    busy = true
    form.querySelector('[type="submit"]').disabled = true
    try {
      const [response, payload] = await requestJson('POST', '/api/auth/tokens', {
        name: form.elements.name.value.trim(), scopes: selectedScopes,
        access,
        expires_in_days: form.elements.expires_in_days.value === 'never'
          ? null : Number(form.elements.expires_in_days.value),
      })
      if (!response.ok) { setStatus(createStatus, responseError(response, payload), true); return }
      createDialog.close()
      page.querySelector('[data-revealed-token]').value = payload.token
      setStatus(page.querySelector('[data-copy-status]'), '')
      revealDialog.showModal()
      try {
        const [listResponse, listPayload] = await requestJson('GET', '/api/auth/tokens')
        if (listResponse.ok && Array.isArray(listPayload?.tokens)) {
          tokens = listPayload.tokens
          renderRows()
          setStatus(status, '')
        } else setStatus(status, 'Token created; refresh to update the list.', true)
      } catch { setStatus(status, 'Token created; refresh to update the list.', true) }
    } catch { setStatus(createStatus, 'Could not create token.', true) }
    finally { busy = false; form.querySelector('[type="submit"]').disabled = false }
  })
  page.querySelector('[data-copy]').addEventListener('click', async () => {
    const field = page.querySelector('[data-revealed-token]')
    const copyStatus = page.querySelector('[data-copy-status]')
    try {
      await navigator.clipboard.writeText(field.value)
      setStatus(copyStatus, 'Copied.', false, true)
    } catch { field.select(); setStatus(copyStatus, 'Select and copy the token shown above.', true) }
  })
  page.querySelector('[data-done]').addEventListener('click', () => revealDialog.close())
  revealDialog.addEventListener('close', () => { page.querySelector('[data-revealed-token]').value = '' })
  page.querySelector('[data-close-activity]').addEventListener('click', () => activityDialog.close())
  page.querySelector('[data-cancel-access]').addEventListener('click', () => accessDialog.close())
  page.querySelector('[data-save-access]').addEventListener('click', async () => {
    if (!editingToken) return
    const save = page.querySelector('[data-save-access]')
    const accessStatus = page.querySelector('[data-access-status]')
    save.disabled = true
    try {
      const [response, payload] = await requestJson('PATCH', `/api/auth/tokens/${editingToken.id}/access`,
        { access: collectAccess(page.querySelector('[data-edit-access]')) })
      if (!response.ok) { setStatus(accessStatus, responseError(response, payload), true); return }
      editingToken.access = payload.access
      editingToken.scopes = payload.scopes
      renderRows()
      accessDialog.close()
      setStatus(status, 'Access saved.', false, true)
    } catch { setStatus(accessStatus, 'Could not save access.', true) }
    finally { save.disabled = false }
  })
}
