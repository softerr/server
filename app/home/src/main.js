import './style.css'
import { startAuthApp } from '@softerr/shared/auth-app.js'
import { renderMedia } from './media.js'
import { renderBackups } from './backups.js'
import { renderTokens } from './tokens.js'
import { createPageNotice } from '@softerr/shared/page-notice.js'
import { deleteIcon, editIcon } from '@softerr/shared/icons.js'

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
      <dialog id="edit-user-dialog" class="user-dialog" aria-labelledby="edit-user-title">
        <form id="edit-user-form">
          <h2 id="edit-user-title">Edit user</h2>
          <label class="field"><span>Username</span><input name="username" maxlength="100" required autocomplete="off"></label>
          <label class="field"><span>Email</span><input name="email" type="email" maxlength="255" required autocomplete="off"></label>
          <p id="edit-user-status" class="form-status" role="status" aria-live="polite"></p>
          <div class="user-dialog-actions">
            <button id="cancel-edit-user" class="auth-button auth-button-secondary" type="button">Cancel</button>
            <button id="confirm-edit-user" class="auth-button auth-button-primary" type="submit">Save changes</button>
          </div>
        </form>
      </dialog>
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

  const notice = createPageNotice(app.querySelector('.users-page'))
  const status = app.querySelector('#users-status')
  const tableWrap = app.querySelector('#users-table-wrap')
  const body = app.querySelector('#users-table-body')
  const editDialog = app.querySelector('#edit-user-dialog')
  const editForm = app.querySelector('#edit-user-form')
  const editStatus = app.querySelector('#edit-user-status')
  const confirmEdit = app.querySelector('#confirm-edit-user')
  const cancelEdit = app.querySelector('#cancel-edit-user')
  const deleteDialog = app.querySelector('#delete-user-dialog')
  const deleteStatus = app.querySelector('#delete-user-status')
  const confirmDelete = app.querySelector('#confirm-delete-user')
  const cancelDelete = app.querySelector('#cancel-delete-user')
  let deletingRow = null
  let editingRow = null
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
      for (const [index, value] of [user.id, user.username, user.email].entries()) {
        const cell = document.createElement('td')
        cell.textContent = String(value)
        if (index === 1) cell.className = 'user-username'
        if (index === 2) cell.className = 'user-email'
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
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'user-edit'
      edit.innerHTML = editIcon
      edit.setAttribute('aria-label', `Edit ${user.username}`)
      edit.title = `Edit ${user.username}`
      edit.disabled = user.deleting
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
      action.append(edit, remove, rowStatus)
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
        setStatus(rowStatus, '')
        notice.show(`Could not change ${row.dataset.username}'s role: ${responseError(response, payload)}`, 'error')
        return
      }
      select.dataset.savedRole = payload.role
      select.value = payload.role
      setStatus(rowStatus, '')
      notice.show(`${row.dataset.username}'s role changed to ${payload.role}.`)
    } catch {
      if (app.contains(row)) {
        select.value = select.dataset.savedRole
        setStatus(rowStatus, '')
        notice.show(`Could not change ${row.dataset.username}'s role. Please try again.`, 'error')
      }
    } finally {
      if (app.contains(row)) select.disabled = false
    }
  })

  body.addEventListener('click', (event) => {
    const edit = event.target.closest('.user-edit')
    if (!edit || edit.disabled || !body.contains(edit)) return
    editingRow = edit.closest('tr')
    editForm.elements.username.value = editingRow.querySelector('.user-username').textContent
    editForm.elements.email.value = editingRow.querySelector('.user-email').textContent
    setStatus(editStatus, '')
    editDialog.showModal()
    editForm.elements.username.focus()
  })

  editDialog.addEventListener('cancel', (event) => {
    if (confirmEdit.disabled) event.preventDefault()
  })
  cancelEdit.addEventListener('click', () => editDialog.close())
  editForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!editingRow || confirmEdit.disabled) return
    const row = editingRow
    confirmEdit.disabled = true
    cancelEdit.disabled = true
    setStatus(editStatus, 'Saving…')
    try {
      const [response, payload] = await requestJson('PATCH', `/api/auth/users/${row.dataset.userId}`, {
        username: editForm.elements.username.value.trim(),
        email: editForm.elements.email.value.trim(),
      })
      if (!app.contains(editDialog)) return
      if (!response.ok) {
        setStatus(editStatus, responseError(response, payload), true)
        return
      }
      row.dataset.username = payload.username
      row.querySelector('.user-username').textContent = payload.username
      row.querySelector('.user-email').textContent = payload.email
      row.querySelector('.role-select').setAttribute('aria-label', `Role for ${payload.username}`)
      row.querySelector('.user-edit').setAttribute('aria-label', `Edit ${payload.username}`)
      row.querySelector('.user-edit').title = `Edit ${payload.username}`
      row.querySelector('.user-delete').setAttribute('aria-label', `Delete ${payload.username}`)
      row.querySelector('.user-delete').title = `Delete ${payload.username}`
      row.querySelector('.user-approve')?.setAttribute('aria-label', `Approve ${payload.username}`)
      if (payload.id === currentUser.id) {
        currentUser.username = payload.username
        currentUser.email = payload.email
        app.querySelector('#nav-username').textContent = payload.username
      }
      notice.show(`${payload.username} updated.`)
      editingRow = null
      editDialog.close()
    } catch {
      if (app.contains(editDialog)) setStatus(editStatus, 'Could not update user. Please try again.', true)
    } finally {
      confirmEdit.disabled = false
      cancelEdit.disabled = false
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
        setStatus(rowStatus, '')
        notice.show(`Could not approve ${row.dataset.username}: ${responseError(response, payload)}`, 'error')
        approve.disabled = false
        return
      }
      approve.parentElement.textContent = 'Approved'
      row.querySelector('.role-select').disabled = payload.id === currentUser.id
      setStatus(rowStatus, '')
      notice.show(`${row.dataset.username} approved.`)
    } catch {
      if (app.contains(row)) {
        approve.disabled = false
        setStatus(rowStatus, '')
        notice.show(`Could not approve ${row.dataset.username}. Please try again.`, 'error')
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
      notice.show(`${row.dataset.username} deleted.`)
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
  views: ['users', 'media', 'backups', 'tokens'],
  links: [
    { view: 'apps', label: 'Apps' },
    { view: 'media', label: 'Media', roles: ['user', 'mod', 'admin'] },
    { view: 'users', label: 'Users', roles: ['admin'] },
    { view: 'backups', label: 'Backups', roles: ['admin'] },
    { view: 'tokens', label: 'API tokens', roles: ['user', 'mod', 'admin'] },
  ],
  showLinksWhenLoggedOut: true,
  showGuestLogin: true,
  renderView(view, app, helpers) {
    if (view === 'media') {
      renderMedia(app, helpers)
      return true
    }
    if (view === 'users') {
      renderUsers(app, helpers)
      return true
    }
    if (view === 'backups') {
      renderBackups(app, helpers)
      return true
    }
    if (view === 'tokens') {
      renderTokens(app, helpers)
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
          <a class="app-card" href="/musico/">
            <span class="app-card-title">Musico</span>
            <span class="app-card-description">Open Musico</span>
          </a>
          <a class="app-card" href="/mdb/">
            <span class="app-card-title">MDB</span>
            <span class="app-card-description">Your database workspace</span>
          </a>
        </div>
      </main>
    `
    return true
  },
})
