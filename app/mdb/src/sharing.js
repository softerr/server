export function setupMdbSharing(page, { endpoint, requestJson, responseError, setStatus, notice }) {
  const button = page.querySelector('#mdb-share-button')
  const dialog = page.querySelector('#mdb-share-dialog')
  const form = page.querySelector('#mdb-share-form')
  const status = page.querySelector('#mdb-share-status')
  const list = page.querySelector('#mdb-share-list')

  function showShares(shares) {
    list.replaceChildren()
    if (shares.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'mdb-share-empty'
      empty.textContent = 'Only you can access this database.'
      list.append(empty)
      return
    }
    for (const share of shares) {
      const row = document.createElement('div')
      row.className = 'mdb-share-row'
      const name = document.createElement('span')
      name.textContent = share.username ?? `User ${share.user_id}`
      const permission = document.createElement('select')
      permission.setAttribute('aria-label', `Access for ${name.textContent}`)
      for (const [value, label] of [['view', 'Can view'], ['edit', 'Can edit']]) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = label
        permission.append(option)
      }
      permission.value = share.permission
      permission.addEventListener('change', async () => {
        permission.disabled = true
        setStatus(status, '')
        try {
          const [response, payload] = await requestJson('PATCH',
            `${endpoint}/shares/${share.user_id}`, { permission: permission.value })
          if (!response.ok) throw new Error(responseError(response, payload))
          share.permission = payload.permission
          notice.show(`Updated access for ${name.textContent}.`)
        } catch (error) {
          permission.value = share.permission
          setStatus(status, error.message || 'Could not update access.', true)
        } finally { permission.disabled = false }
      })
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'auth-button auth-button-secondary'
      remove.textContent = 'Remove'
      remove.setAttribute('aria-label', `Remove access for ${name.textContent}`)
      remove.addEventListener('click', async () => {
        remove.disabled = true
        setStatus(status, '')
        try {
          const [response, payload] = await requestJson('DELETE',
            `${endpoint}/shares/${share.user_id}`)
          if (!response.ok) throw new Error(responseError(response, payload))
          row.remove()
          if (list.children.length === 0) showShares([])
          notice.show(`Removed access for ${name.textContent}.`)
        } catch (error) {
          setStatus(status, error.message || 'Could not remove access.', true)
          remove.disabled = false
        }
      })
      row.append(name, permission, remove)
      list.append(row)
    }
  }

  button.addEventListener('click', async () => {
    form.reset()
    list.replaceChildren()
    setStatus(status, 'Loading shared users…')
    dialog.showModal()
    try {
      const [response, payload] = await requestJson('GET', `${endpoint}/shares`)
      if (!dialog.open) return
      if (!response.ok) throw new Error(responseError(response, payload))
      showShares(payload.shares)
      setStatus(status, '')
      form.elements.username.focus()
    } catch (error) {
      if (dialog.open) setStatus(status, error.message || 'Could not load shared users.', true)
    }
  })
  page.querySelector('#mdb-share-close').addEventListener('click', () => dialog.close())
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const submit = form.querySelector('[type="submit"]')
    if (submit.disabled) return
    submit.disabled = true
    setStatus(status, '')
    try {
      const [response, payload] = await requestJson('POST', `${endpoint}/shares`, {
        username: form.elements.username.value.trim(), permission: form.elements.permission.value,
      })
      if (!response.ok) throw new Error(responseError(response, payload))
      const [listResponse, listPayload] = await requestJson('GET', `${endpoint}/shares`)
      if (!listResponse.ok) throw new Error(responseError(listResponse, listPayload))
      if (!dialog.open) return
      showShares(listPayload.shares)
      form.elements.username.value = ''
      form.elements.username.focus()
      notice.show(`Shared with ${payload.username}.`)
    } catch (error) {
      if (dialog.open) setStatus(status, error.message || 'Could not share database.', true)
    } finally { submit.disabled = false }
  })
}
