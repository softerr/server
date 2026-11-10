const SCOPES = [
  ['quiz:read', 'Read quizzes'],
  ['quiz:write', 'Edit quizzes and attempts'],
  ['musico:read', 'Read Musico'],
  ['musico:write', 'Edit Musico'],
  ['mdb:read', 'Read MDB'],
  ['mdb:write', 'Edit MDB'],
  ['media:read', 'Read media'],
  ['media:write', 'Upload and edit media'],
]

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : 'Never'
}

function isExpired(token) {
  return token.expires !== null && new Date(token.expires) <= new Date()
}

export function renderTokens(app, { requestJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="tokens-page">
      <div class="tokens-heading">
        <h1 class="section-title">API tokens</h1>
        <button type="button" class="auth-button auth-button-primary" data-create-token>Create token</button>
      </div>
      <p class="tokens-description">Each token has its own service account. Its name identifies actions made with that token.</p>
      <p class="form-status" data-tokens-status role="status" aria-live="polite">Loading tokens…</p>
      <div class="tokens-table-wrap" data-tokens-table hidden>
        <table class="tokens-table">
          <thead><tr><th>Service account</th><th>Permissions</th><th>My quizzes</th><th>Musico</th><th>MDB</th><th>Expires</th><th>Last used</th><th>Status</th><th></th></tr></thead>
          <tbody data-tokens-body></tbody>
        </table>
      </div>
      <dialog class="user-dialog token-dialog" data-create-dialog aria-labelledby="create-token-title">
        <h2 id="create-token-title">Create API token</h2>
        <form data-token-form>
          <label class="field"><span>Name</span><input name="name" maxlength="100" required placeholder="Automation name"></label>
          <fieldset class="token-scopes"><legend>Permissions</legend><div data-scope-choices></div></fieldset>
          <div class="token-quiz-access" data-create-access></div>
          <div class="token-app-access" data-create-app-access></div>
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
      <dialog class="user-dialog token-dialog" data-app-access-dialog aria-labelledby="token-app-access-title">
        <h2 id="token-app-access-title">App access</h2>
        <div class="token-app-access" data-edit-app-access></div>
        <p class="form-status" data-app-access-status role="status" aria-live="polite"></p>
        <div class="user-dialog-actions">
          <button type="button" class="auth-button auth-button-secondary" data-cancel-app-access>Cancel</button>
          <button type="button" class="auth-button auth-button-primary" data-save-app-access>Save access</button>
        </div>
      </dialog>
      <dialog class="user-dialog token-dialog" data-access-dialog aria-labelledby="token-access-title">
        <h2 id="token-access-title">Quiz access</h2>
        <div class="token-quiz-access" data-edit-access></div>
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
          <button type="button" class="auth-button auth-button-secondary" data-copy-token>Copy</button>
          <button type="button" class="auth-button auth-button-primary" data-done-token>Done</button>
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
        <div class="user-dialog-actions"><button type="button" class="auth-button auth-button-secondary" data-close-activity>Close</button></div>
      </dialog>
    </main>
  `
  const status = page.querySelector('[data-tokens-status]')
  const table = page.querySelector('[data-tokens-table]')
  const body = page.querySelector('[data-tokens-body]')
  const createButton = page.querySelector('[data-create-token]')
  const createDialog = page.querySelector('[data-create-dialog]')
  const form = page.querySelector('[data-token-form]')
  const createStatus = page.querySelector('[data-create-status]')
  const revealDialog = page.querySelector('[data-reveal-dialog]')
  const revealedToken = page.querySelector('[data-revealed-token]')
  const copyStatus = page.querySelector('[data-copy-status]')
  const activityDialog = page.querySelector('[data-activity-dialog]')
  const activityStatus = page.querySelector('[data-activity-status]')
  const activityBody = page.querySelector('[data-activity-body]')
  const accessDialog = page.querySelector('[data-access-dialog]')
  const accessStatus = page.querySelector('[data-access-status]')
  const appAccessDialog = page.querySelector('[data-app-access-dialog]')
  const appAccessStatus = page.querySelector('[data-app-access-status]')
  let tokens = []
  let quizzes = []
  let editingToken = null
  let busy = false

  for (const [scope, label] of SCOPES) {
    const choice = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.value = scope
    checkbox.name = 'scope'
    const text = document.createElement('span')
    text.textContent = label
    choice.append(checkbox, text)
    form.querySelector('[data-scope-choices]').append(choice)
  }
  function accessLabel(access) {
    if (access.all === 'read') return 'All · read'
    if (access.all === 'edit') return 'All · edit'
    if (!access.quizzes.length) return 'None'
    return `${access.quizzes.length} selected`
  }

  function renderAppAccess(container, access = { musico: 'none', mdb: 'none' }, scopes = []) {
    container.replaceChildren()
    for (const [appName, label] of [['musico', 'Musico library'], ['mdb', 'MDB databases']]) {
      const field = document.createElement('label')
      field.className = 'field'
      const caption = document.createElement('span')
      caption.textContent = label
      const select = document.createElement('select')
      select.dataset.appAccess = appName
      select.innerHTML = '<option value="none">No access to my data</option><option value="read">Read my data</option><option value="edit">Edit my data</option>'
      select.value = access[appName] ?? 'none'
      select.querySelector('[value="read"]').disabled = !scopes.includes(`${appName}:read`)
      select.querySelector('[value="edit"]').disabled = !scopes.includes(`${appName}:read`) || !scopes.includes(`${appName}:write`)
      if (select.selectedOptions[0]?.disabled) select.value = 'none'
      field.append(caption, select)
      container.append(field)
    }
  }

  function collectAppAccess(container) {
    return Object.fromEntries([...container.querySelectorAll('[data-app-access]')]
      .map((select) => [select.dataset.appAccess, select.value]))
  }

  function renderAccess(container, access = { all: 'none', quizzes: [] }, scopes = null) {
    container.replaceChildren()
    const label = document.createElement('label')
    label.className = 'field'
    const caption = document.createElement('span')
    caption.textContent = 'My quizzes'
    const mode = document.createElement('select')
    mode.innerHTML = '<option value="none">No access</option><option value="selected">Selected quizzes</option><option value="read">All quizzes · read</option><option value="edit">All quizzes · edit</option>'
    mode.value = access.all === 'none' && access.quizzes.length ? 'selected' : access.all
    label.append(caption, mode)
    container.append(label)
    const list = document.createElement('div')
    list.className = 'token-quiz-list'
    const selected = new Map(access.quizzes.map((quiz) => [quiz.id, quiz.permission]))
    for (const quiz of quizzes) {
      const row = document.createElement('label')
      const name = document.createElement('span')
      name.textContent = quiz.name
      const permission = document.createElement('select')
      permission.dataset.quizId = String(quiz.id)
      permission.innerHTML = '<option value="none">No access</option><option value="read">Read</option><option value="edit">Edit</option>'
      permission.value = selected.get(quiz.id) || 'none'
      row.append(name, permission)
      list.append(row)
    }
    if (!quizzes.length) list.textContent = 'No quizzes in your library.'
    container.append(list)
    const update = () => {
      list.hidden = mode.value !== 'selected'
      if (scopes) {
        const hasRead = scopes.includes('quiz:read')
        const hasWrite = scopes.includes('quiz:write')
        mode.querySelector('[value="read"]').disabled = !hasRead
        mode.querySelector('[value="edit"]').disabled = !hasRead || !hasWrite
        mode.querySelector('[value="selected"]').disabled = !hasRead
        for (const select of list.querySelectorAll('select')) {
          select.querySelector('[value="read"]').disabled = !hasRead
          select.querySelector('[value="edit"]').disabled = !hasRead || !hasWrite
        }
      }
    }
    mode.addEventListener('change', update)
    update()
  }

  function collectAccess(container) {
    const mode = container.querySelector('.field select').value
    return { all: mode === 'selected' ? 'none' : mode,
      quizzes: mode === 'selected' ? [...container.querySelectorAll('[data-quiz-id]')]
        .filter((select) => select.value !== 'none')
        .map((select) => ({ id: Number(select.dataset.quizId), permission: select.value })) : [] }
  }

  function createScopes() {
    return [...form.querySelectorAll('[name="scope"]:checked')].map((item) => item.value)
  }
  form.querySelector('[data-scope-choices]').addEventListener('change', () => {
    const access = collectAccess(page.querySelector('[data-create-access]'))
    renderAccess(page.querySelector('[data-create-access]'), access, createScopes())
    const appAccess = collectAppAccess(page.querySelector('[data-create-app-access]'))
    renderAppAccess(page.querySelector('[data-create-app-access]'), appAccess, createScopes())
  })

  function renderRows() {
    body.replaceChildren()
    for (const token of tokens) {
      const row = document.createElement('tr')
      for (const value of [`${token.username} · #${token.user_id}`, token.scopes.join(', '),
        accessLabel(token.quiz_access),
        token.app_access.musico, token.app_access.mdb,
        dateLabel(token.expires), dateLabel(token.last_used_at),
        token.revoked_at ? 'Revoked' : isExpired(token) ? 'Expired' : 'Active']) {
        const cell = document.createElement('td')
        cell.textContent = value
        row.append(cell)
      }
      const actionCell = document.createElement('td')
      const activityButton = document.createElement('button')
      activityButton.type = 'button'
      activityButton.className = 'text-button'
      activityButton.textContent = 'Activity'
      activityButton.addEventListener('click', async () => {
        activityBody.replaceChildren()
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
            activityBody.append(actionRow)
          }
        } catch {
          setStatus(activityStatus, 'Could not load token activity.', true)
        }
      })
      actionCell.append(activityButton)
      if (!token.revoked_at && !isExpired(token)) {
        const appEdit = document.createElement('button')
        appEdit.type = 'button'
        appEdit.className = 'text-button'
        appEdit.textContent = 'App access'
        appEdit.addEventListener('click', () => {
          editingToken = token
          renderAppAccess(page.querySelector('[data-edit-app-access]'), token.app_access, token.scopes)
          setStatus(appAccessStatus, '')
          appAccessDialog.showModal()
        })
        actionCell.append(appEdit)
        const edit = document.createElement('button')
        edit.type = 'button'
        edit.className = 'text-button'
        edit.textContent = 'Quiz access'
        edit.addEventListener('click', () => {
          editingToken = token
          renderAccess(page.querySelector('[data-edit-access]'), token.quiz_access, token.scopes)
          setStatus(accessStatus, '')
          accessDialog.showModal()
        })
        actionCell.append(edit)
        const revoke = document.createElement('button')
        revoke.type = 'button'
        revoke.className = 'text-button'
        revoke.textContent = 'Revoke'
        revoke.setAttribute('aria-label', `Revoke ${token.name}`)
        revoke.addEventListener('click', async () => {
          if (!window.confirm(`Revoke ${token.name}?`)) return
          revoke.disabled = true
          try {
            const [response, payload] = await requestJson('DELETE', `/api/auth/tokens/${token.id}`)
            if (!response.ok) {
              setStatus(status, responseError(response, payload), true)
              revoke.disabled = false
              return
            }
            token.revoked_at = new Date().toISOString()
            renderRows()
            setStatus(status, 'Token revoked.', false, true)
          } catch {
            setStatus(status, 'Could not revoke token.', true)
            revoke.disabled = false
          }
        })
        actionCell.append(revoke)
      }
      row.append(actionCell)
      body.append(row)
    }
    table.hidden = tokens.length === 0
    if (!tokens.length) setStatus(status, 'No API tokens yet.')
  }

  Promise.all([requestJson('GET', '/api/auth/tokens'), requestJson('GET', '/api/quiz/quizzes')]).then(([[tokenResponse, tokenData], [quizResponse, quizData]]) => {
    if (!page.isConnected) return
    if (!tokenResponse.ok || !Array.isArray(tokenData?.tokens)) {
      setStatus(status, responseError(tokenResponse, tokenData), true)
      return
    }
    tokens = tokenData.tokens
    if (quizResponse.ok && Array.isArray(quizData?.quizzes)) quizzes = quizData.quizzes
    else setStatus(status, 'Tokens loaded, but quiz access choices could not be loaded.', true)
    setStatus(status, '')
    renderRows()
  }).catch(() => {
    if (page.isConnected) setStatus(status, 'Could not load API tokens.', true)
  })

  createButton.addEventListener('click', () => {
    form.reset()
    renderAccess(page.querySelector('[data-create-access]'), undefined, createScopes())
    renderAppAccess(page.querySelector('[data-create-app-access]'), undefined, createScopes())
    setStatus(createStatus, '')
    createDialog.showModal()
    form.elements.name.focus()
  })
  form.querySelector('[data-cancel-create]').addEventListener('click', () => createDialog.close())
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    const scopes = createScopes()
    if (!scopes.length) {
      setStatus(createStatus, 'Select at least one permission.', true)
      return
    }
    busy = true
    form.querySelector('[type="submit"]').disabled = true
    try {
      const [response, payload] = await requestJson('POST', '/api/auth/tokens', {
        name: form.elements.name.value.trim(),
        scopes,
        quiz_access: collectAccess(page.querySelector('[data-create-access]')),
        app_access: collectAppAccess(page.querySelector('[data-create-app-access]')),
        expires_in_days: form.elements.expires_in_days.value === 'never'
          ? null : Number(form.elements.expires_in_days.value),
      })
      if (!response.ok) {
        setStatus(createStatus, responseError(response, payload), true)
        return
      }
      createDialog.close()
      revealedToken.value = payload.token
      setStatus(copyStatus, '')
      revealDialog.showModal()
      try {
        const [listResponse, listPayload] = await requestJson('GET', '/api/auth/tokens')
        if (listResponse.ok && Array.isArray(listPayload?.tokens)) {
          tokens = listPayload.tokens
          renderRows()
          setStatus(status, '')
        } else {
          setStatus(status, 'Token created; refresh to update the list.', true)
        }
      } catch {
        setStatus(status, 'Token created; refresh to update the list.', true)
      }
    } catch {
      setStatus(createStatus, 'Could not create token.', true)
    } finally {
      busy = false
      form.querySelector('[type="submit"]').disabled = false
    }
  })
  page.querySelector('[data-copy-token]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(revealedToken.value)
      setStatus(copyStatus, 'Copied.', false, true)
    } catch {
      revealedToken.select()
      setStatus(copyStatus, 'Select and copy the token shown above.', true)
    }
  })
  page.querySelector('[data-done-token]').addEventListener('click', () => revealDialog.close())
  revealDialog.addEventListener('close', () => { revealedToken.value = '' })
  page.querySelector('[data-close-activity]').addEventListener('click', () => activityDialog.close())
  page.querySelector('[data-cancel-access]').addEventListener('click', () => accessDialog.close())
  page.querySelector('[data-cancel-app-access]').addEventListener('click', () => appAccessDialog.close())
  page.querySelector('[data-save-app-access]').addEventListener('click', async () => {
    if (!editingToken) return
    const save = page.querySelector('[data-save-app-access]')
    save.disabled = true
    try {
      const [response, payload] = await requestJson('PATCH', `/api/auth/tokens/${editingToken.id}/app-access`,
        { app_access: collectAppAccess(page.querySelector('[data-edit-app-access]')) })
      if (!response.ok) { setStatus(appAccessStatus, responseError(response, payload), true); return }
      editingToken.app_access = payload.app_access
      renderRows()
      appAccessDialog.close()
      setStatus(status, 'App access saved.', false, true)
    } catch { setStatus(appAccessStatus, 'Could not save app access.', true) }
    finally { save.disabled = false }
  })
  page.querySelector('[data-save-access]').addEventListener('click', async () => {
    if (!editingToken) return
    const save = page.querySelector('[data-save-access]')
    save.disabled = true
    try {
      const [response, payload] = await requestJson('PATCH', `/api/auth/tokens/${editingToken.id}/quiz-access`,
        { quiz_access: collectAccess(page.querySelector('[data-edit-access]')) })
      if (!response.ok) { setStatus(accessStatus, responseError(response, payload), true); return }
      editingToken.quiz_access = payload.quiz_access
      renderRows()
      accessDialog.close()
      setStatus(status, 'Quiz access saved.', false, true)
    } catch { setStatus(accessStatus, 'Could not save quiz access.', true) }
    finally { save.disabled = false }
  })
}
