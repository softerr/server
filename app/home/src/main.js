import './style.css'
import { startAuthApp } from '../../shared/auth-app.js'

const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>'

function renderUsers(app, { currentUser, requestJson, responseError, setStatus }) {
  app.querySelector('#page').innerHTML = `
    <main class="users-page">
      <h1 class="section-title">Users</h1>
      <p id="users-status" class="form-status" role="status" aria-live="polite">Loading users…</p>
      <div id="users-table-wrap" class="users-table-wrap" hidden>
        <table class="users-table">
          <thead><tr><th scope="col">ID</th><th scope="col">Username</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Verified</th><th scope="col">Approval</th><th scope="col">Created</th><th scope="col">Action</th></tr></thead>
          <tbody id="users-table-body"></tbody>
        </table>
      </div>
      <dialog id="delete-user-dialog" class="user-dialog" aria-labelledby="delete-user-title">
        <h2 id="delete-user-title">Delete user?</h2>
        <p>Delete <strong id="delete-user-name"></strong> and all their quizzes? This cannot be undone.</p>
        <p id="delete-user-status" class="form-status" role="status" aria-live="polite"></p>
        <div class="user-dialog-actions">
          <button id="cancel-delete-user" class="auth-button auth-button-secondary" type="button">Cancel</button>
          <button id="confirm-delete-user" class="auth-button auth-button-primary" type="button">Delete user</button>
        </div>
      </dialog>
    </main>
  `

  const status = app.querySelector('#users-status')
  const tableWrap = app.querySelector('#users-table-wrap')
  const body = app.querySelector('#users-table-body')
  const deleteDialog = app.querySelector('#delete-user-dialog')
  const deleteStatus = app.querySelector('#delete-user-status')
  const confirmDelete = app.querySelector('#confirm-delete-user')
  const cancelDelete = app.querySelector('#cancel-delete-user')
  let deletingRow = null
  requestJson('GET', '/api/auth/users').then(([response, payload]) => {
    if (!app.contains(body)) return
    if (!response.ok) {
      setStatus(status, responseError(response, payload), true)
      return
    }
    if (!Array.isArray(payload?.users)) {
      setStatus(status, 'Could not load users. Please try again.', true)
      return
    }
    const rows = document.createDocumentFragment()
    for (const user of payload.users) {
      const row = document.createElement('tr')
      row.dataset.userId = String(user.id)
      row.dataset.username = user.username
      for (const value of [user.id, user.username, user.email]) {
        const cell = document.createElement('td')
        cell.textContent = String(value)
        row.append(cell)
      }

      const roleCell = document.createElement('td')
      const roleSelect = document.createElement('select')
      roleSelect.className = 'role-select'
      roleSelect.dataset.savedRole = user.role
      roleSelect.setAttribute('aria-label', `Role for ${user.username}`)
      for (const role of ['user', 'mod', 'admin']) {
        const option = document.createElement('option')
        option.value = role
        option.textContent = role
        roleSelect.append(option)
      }
      roleSelect.value = user.role
      roleSelect.disabled = user.id === currentUser.id || user.deleting || !user.approved
      roleCell.append(roleSelect)
      row.append(roleCell)

      const verifiedCell = document.createElement('td')
      verifiedCell.textContent = user.verified ? 'Yes' : 'No'
      row.append(verifiedCell)

      const approvalCell = document.createElement('td')
      if (user.approved) {
        approvalCell.textContent = 'Approved'
      } else if (user.verified && !user.deleting) {
        const approve = document.createElement('button')
        approve.type = 'button'
        approve.className = 'user-approve'
        approve.textContent = 'Approve'
        approve.setAttribute('aria-label', `Approve ${user.username}`)
        approvalCell.append(approve)
      } else {
        approvalCell.textContent = user.deleting ? 'Deletion pending' : 'Awaiting verification'
      }
      row.append(approvalCell)

      for (const value of [user.created]) {
        const cell = document.createElement('td')
        cell.textContent = String(value)
        row.append(cell)
      }

      const actionCell = document.createElement('td')
      const action = document.createElement('div')
      action.className = 'role-action'
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'user-delete'
      remove.innerHTML = deleteIcon
      remove.setAttribute('aria-label', `Delete ${user.username}`)
      remove.title = `Delete ${user.username}`
      remove.disabled = user.id === currentUser.id
      const rowStatus = document.createElement('span')
      rowStatus.className = 'role-status'
      rowStatus.setAttribute('role', 'status')
      rowStatus.setAttribute('aria-live', 'polite')
      if (user.deleting) rowStatus.textContent = 'Deletion pending'
      else if (user.id === currentUser.id) rowStatus.textContent = 'Your account'
      action.append(remove, rowStatus)
      actionCell.append(action)
      row.append(actionCell)
      rows.append(row)
    }
    body.append(rows)
    tableWrap.hidden = payload.users.length === 0
    setStatus(status, payload.users.length ? `${payload.users.length} users` : 'No users found.')
  }).catch(() => {
    if (app.contains(body)) setStatus(status, 'Could not load users. Please try again.', true)
  })

  body.addEventListener('change', async (event) => {
    const select = event.target.closest('.role-select')
    if (!select || select.disabled || !body.contains(select)) return
    const row = select.closest('tr')
    if (select.value === select.dataset.savedRole) return
    const rowStatus = row.querySelector('.role-status')
    const requestedRole = select.value
    select.disabled = true
    setStatus(rowStatus, 'Saving…')
    try {
      const [response, payload] = await requestJson('PATCH', `/api/auth/users/${row.dataset.userId}/role`, { role: requestedRole })
      if (!app.contains(row)) return
      if (!response.ok) {
        select.value = select.dataset.savedRole
        setStatus(rowStatus, responseError(response, payload), true)
        return
      }
      select.dataset.savedRole = payload.role
      select.value = payload.role
      setStatus(rowStatus, 'Saved')
    } catch {
      if (app.contains(row)) {
        select.value = select.dataset.savedRole
        setStatus(rowStatus, 'Could not save role. Please try again.', true)
      }
    } finally {
      if (app.contains(row)) select.disabled = false
    }
  })

  body.addEventListener('click', (event) => {
    const remove = event.target.closest('.user-delete')
    if (!remove || remove.disabled || !body.contains(remove)) return
    deletingRow = remove.closest('tr')
    app.querySelector('#delete-user-name').textContent = deletingRow.dataset.username
    setStatus(deleteStatus, '')
    deleteDialog.showModal()
  })

  body.addEventListener('click', async (event) => {
    const approve = event.target.closest('.user-approve')
    if (!approve || approve.disabled || !body.contains(approve)) return
    const row = approve.closest('tr')
    const rowStatus = row.querySelector('.role-status')
    approve.disabled = true
    setStatus(rowStatus, 'Approving…')
    try {
      const [response, payload] = await requestJson('POST', `/api/auth/users/${row.dataset.userId}/approve`)
      if (!app.contains(row)) return
      if (!response.ok) {
        setStatus(rowStatus, responseError(response, payload), true)
        approve.disabled = false
        return
      }
      approve.parentElement.textContent = 'Approved'
      row.querySelector('.role-select').disabled = payload.id === currentUser.id
      setStatus(rowStatus, 'Approved')
    } catch {
      if (app.contains(row)) {
        approve.disabled = false
        setStatus(rowStatus, 'Could not approve user. Please try again.', true)
      }
    }
  })

  deleteDialog.addEventListener('cancel', (event) => {
    if (confirmDelete.disabled) event.preventDefault()
  })
  cancelDelete.addEventListener('click', () => deleteDialog.close())
  confirmDelete.addEventListener('click', async () => {
    if (!deletingRow || confirmDelete.disabled) return
    const row = deletingRow
    confirmDelete.disabled = true
    cancelDelete.disabled = true
    setStatus(deleteStatus, 'Deleting user…')
    try {
      const [response, payload] = await requestJson('DELETE', `/api/auth/users/${row.dataset.userId}`)
      if (!app.contains(deleteDialog)) return
      if (!response.ok) {
        setStatus(deleteStatus, responseError(response, payload), true)
        return
      }
      row.remove()
      tableWrap.hidden = body.children.length === 0
      setStatus(status, body.children.length ? `${body.children.length} users` : 'No users found.')
      deletingRow = null
      deleteDialog.close()
    } catch {
      if (app.contains(deleteDialog)) setStatus(deleteStatus, 'Could not delete user. Please try again.', true)
    } finally {
      confirmDelete.disabled = false
      cancelDelete.disabled = false
    }
  })
}

startAuthApp({
  name: 'Home',
  homeHref: '/',
  signupPrompt: 'New here?',
  defaultView: 'apps',
  publicViews: ['apps'],
  views: ['users'],
  links: [
    { view: 'apps', label: 'Apps' },
    { view: 'users', label: 'Users', roles: ['admin'] },
  ],
  showLinksWhenLoggedOut: true,
  showGuestLogin: true,
  renderView(view, app, helpers) {
    if (view === 'users') {
      renderUsers(app, helpers)
      return true
    }
    if (view !== 'apps') return false
    app.querySelector('#page').innerHTML = `
      <main class="apps-page">
        <h1 class="section-title">Apps</h1>
        <div class="apps-grid">
          <a class="app-card" href="/quiz/">
            <span class="app-card-title">Quiz</span>
            <span class="app-card-description">Open your quizzes</span>
          </a>
        </div>
      </main>
    `
    return true
  },
})
