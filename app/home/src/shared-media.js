import { formatImageDetails } from './media-format.js'
import { selectImageRange } from './media-selection.js'

const imageUrl = (id) => `/api/media/images/${id}`
const renameIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4.5-1 11-11a2.12 2.12 0 0 0-3-3l-11 11L4 20Z" /></svg>'
const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>'
const folderIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
const ungroupedIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m5 20 14-14"/></svg>'
const createFolderIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6m-3-3h6"/></svg>'

export function renderSharedMedia(section, { currentUser, requestJson, responseError, setStatus, notify }) {
  const admin = currentUser.role === 'admin'
  section.innerHTML = `
    <div id="shared-breadcrumb" class="shared-breadcrumb" hidden></div>
    <div id="shared-folders" class="media-grid"></div>
    <h3 id="shared-image-heading" class="shared-image-heading">Ungrouped images</h3>
    <div id="shared-images" class="media-grid"></div>
    ${admin ? '<div class="shared-move"><button id="shared-move-button" class="auth-button auth-button-secondary" type="button" disabled>Move selected</button></div>' : ''}
    <p id="shared-status" class="form-status" role="status" aria-live="polite">Loading shared library…</p>
    ${admin ? '<dialog id="shared-group-dialog" class="user-dialog" aria-labelledby="shared-group-dialog-title"><form id="shared-group-create"><h2 id="shared-group-dialog-title">Create folder</h2><label class="field"><span>Name</span><input name="name" maxlength="100" required></label><p id="shared-group-dialog-status" class="form-status" role="status" aria-live="polite"></p><div class="user-dialog-actions"><button type="button" class="auth-button auth-button-secondary" data-cancel>Cancel</button><button type="submit" class="auth-button auth-button-primary">Create folder</button></div></form></dialog>' : ''}
    ${admin ? '<dialog id="shared-move-dialog" class="user-dialog" aria-labelledby="shared-move-title"><form id="shared-move-form"><h2 id="shared-move-title">Move images</h2><p id="shared-move-count"></p><fieldset class="media-destination-fieldset"><legend>Destination</legend><div id="shared-destinations" class="media-destinations"></div></fieldset><p id="shared-move-status" class="form-status" role="status" aria-live="polite"></p><div class="user-dialog-actions"><button type="button" class="auth-button auth-button-secondary" data-cancel>Cancel</button><button type="submit" class="auth-button auth-button-primary" disabled>Move images</button></div></form></dialog>' : ''}
  `
  const folderGrid = section.querySelector('#shared-folders')
  const imageGrid = section.querySelector('#shared-images')
  const breadcrumb = section.querySelector('#shared-breadcrumb')
  const imageHeading = section.querySelector('#shared-image-heading')
  const status = section.querySelector('#shared-status')
  const createForm = section.querySelector('#shared-group-create')
  const createDialog = section.querySelector('#shared-group-dialog')
  const createStatus = section.querySelector('#shared-group-dialog-status')
  const moveButton = section.querySelector('#shared-move-button')
  const moveDialog = section.querySelector('#shared-move-dialog')
  const moveForm = section.querySelector('#shared-move-form')
  const moveCount = section.querySelector('#shared-move-count')
  const moveStatus = section.querySelector('#shared-move-status')
  const destinations = section.querySelector('#shared-destinations')
  const moveConfirm = moveForm?.querySelector('[type="submit"]')
  const moveCancel = moveForm?.querySelector('[data-cancel]')
  let groups = []
  let images = []
  let activeGroupId = null
  let busy = false
  const selected = new Set()
  let selectionAnchor = null

  function render() {
    const activeGroup = groups.find((group) => group.id === activeGroupId)
    if (activeGroupId !== null && !activeGroup) activeGroupId = null
    folderGrid.replaceChildren()
    breadcrumb.replaceChildren()
    breadcrumb.hidden = activeGroupId === null
    if (activeGroupId === null) {
      if (admin) {
        const card = document.createElement('div')
        card.className = 'media-folder media-folder-create'
        const open = document.createElement('button')
        open.type = 'button'
        open.className = 'media-folder-open'
        open.setAttribute('aria-label', 'Create folder')
        open.disabled = busy
        open.innerHTML = `<span class="media-folder-icon">${createFolderIcon}</span><span class="media-folder-label"><strong>Create folder</strong><span>New shared folder</span></span>`
        open.addEventListener('click', () => {
          createForm.reset()
          setStatus(createStatus, '')
          createDialog.showModal()
          createForm.querySelector('input[name="name"]').focus()
        })
        card.append(open)
        folderGrid.append(card)
      }
      for (const group of groups) {
        const card = document.createElement('div')
        card.className = 'media-folder'
        const open = document.createElement('button')
        open.type = 'button'
        open.className = 'media-folder-open'
        open.setAttribute('aria-label', `Open ${group.name} folder`)
        const badge = document.createElement('span')
        badge.className = 'media-folder-icon'
        badge.innerHTML = folderIcon
        const label = document.createElement('span')
        label.className = 'media-folder-label'
        const name = document.createElement('strong')
        name.textContent = group.name
        const count = document.createElement('span')
        count.textContent = `${group.image_count} image${group.image_count === 1 ? '' : 's'}`
        label.append(name, count)
        open.append(badge, label)
        open.addEventListener('click', () => {
          activeGroupId = group.id
          render()
        })
        card.append(open)
        if (admin) card.append(folderActions(group))
        folderGrid.append(card)
      }
    } else {
      const back = document.createElement('button')
      back.type = 'button'
      back.className = 'text-button'
      back.textContent = '← Folders'
      back.addEventListener('click', () => { activeGroupId = null; render() })
      const title = document.createElement('strong')
      title.textContent = activeGroup.name
      breadcrumb.append(back, title)
      if (admin) breadcrumb.append(folderActions(activeGroup))
    }
    imageHeading.textContent = activeGroupId === null ? 'Ungrouped images' : 'Images'
    imageGrid.replaceChildren()
    const visible = images.filter((image) => image.group_id === activeGroupId)
    if (!visible.length) {
      const empty = document.createElement('p')
      empty.className = 'media-empty'
      empty.textContent = activeGroupId === null ? 'No ungrouped images.' : 'This folder is empty.'
      imageGrid.append(empty)
    }
    for (const image of visible) {
      const card = document.createElement('article')
      card.className = 'media-card'
      const preview = document.createElement('img')
      preview.src = imageUrl(image.id)
      preview.alt = image.name
      preview.loading = 'lazy'
      const details = document.createElement('div')
      details.className = 'media-card-details'
      const name = document.createElement('span')
      name.className = 'media-card-name'
      name.textContent = image.name
      name.title = image.name
      const metadata = document.createElement('span')
      metadata.className = 'media-card-meta'
      metadata.textContent = formatImageDetails(image)
      details.append(name, metadata)
      card.append(preview, details)
      if (admin) {
        const label = document.createElement('label')
        label.className = 'media-select'
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.dataset.imageSelect = String(image.id)
        checkbox.checked = selected.has(image.id)
        checkbox.disabled = busy
        checkbox.addEventListener('click', (event) => {
          selectionAnchor = selectImageRange(event, image.id, visible.map((item) => item.id),
            selected, selectionAnchor, imageGrid)
          updateMoveButton()
        })
        label.append(checkbox, document.createTextNode('Select'))
        card.append(label)
      }
      imageGrid.append(card)
    }
    updateMoveButton()
  }

  function folderActions(group) {
    const actions = document.createElement('div')
    actions.className = 'media-folder-actions'
    const rename = document.createElement('button')
    rename.type = 'button'
    rename.innerHTML = renameIcon
    rename.setAttribute('aria-label', `Rename ${group.name}`)
    rename.title = `Rename ${group.name}`
    rename.disabled = busy
    rename.addEventListener('click', async () => {
      const name = window.prompt('Rename folder', group.name)
      if (name === null || name.trim() === group.name) return
      busy = true; render()
      try {
        const [response, payload] = await requestJson('PATCH', `/api/media/groups/${group.id}`, { name })
        if (!section.isConnected) return
        if (!response.ok) notify(responseError(response, payload), 'error')
        else if (await refresh()) notify('Folder renamed.')
        else notify('Folder renamed, but the shared library could not reload.', 'error')
      } catch {
        if (section.isConnected) notify('Could not rename folder.', 'error')
      } finally {
        busy = false; if (section.isConnected) render()
      }
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.innerHTML = deleteIcon
    remove.setAttribute('aria-label', `Delete ${group.name}`)
    remove.title = `Delete ${group.name}`
    remove.disabled = busy
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Delete ${group.name}? Its images will become ungrouped.`)) return
      busy = true; render()
      try {
        const [response, payload] = await requestJson('DELETE', `/api/media/groups/${group.id}`)
        if (!section.isConnected) return
        if (!response.ok) notify(responseError(response, payload), 'error')
        else {
          activeGroupId = null
          if (await refresh()) notify('Folder deleted. Its images are ungrouped.')
          else notify('Folder deleted, but the shared library could not reload.', 'error')
        }
      } catch {
        if (section.isConnected) notify('Could not delete folder.', 'error')
      } finally {
        busy = false; if (section.isConnected) render()
      }
    })
    actions.append(rename, remove)
    return actions
  }

  function updateMoveButton() {
    if (!moveButton) return
    moveButton.disabled = busy || !selected.size
    moveButton.textContent = selected.size ? `Move ${selected.size} selected` : 'Move selected'
  }

  function renderDestinations() {
    destinations.replaceChildren()
    for (const [id, name] of [[null, 'Ungrouped'], ...groups.map((group) => [group.id, group.name])]) {
      const label = document.createElement('label')
      label.className = 'media-destination'
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'group_id'
      radio.value = id === null ? '' : String(id)
      const icon = document.createElement('span')
      icon.className = 'media-destination-icon'
      icon.innerHTML = id === null ? ungroupedIcon : folderIcon
      const text = document.createElement('span')
      text.textContent = name
      label.append(radio, icon, text)
      destinations.append(label)
    }
  }

  async function refresh() {
    const [[groupResponse, groupPayload], [imageResponse, imagePayload]] = await Promise.all([
      requestJson('GET', '/api/media/groups'), requestJson('GET', '/api/media/shared-images'),
    ])
    if (!section.isConnected) return false
    if (!groupResponse.ok || !Array.isArray(groupPayload?.groups)) {
      setStatus(status, responseError(groupResponse, groupPayload), true)
      return false
    }
    if (!imageResponse.ok || !Array.isArray(imagePayload?.images)) {
      setStatus(status, responseError(imageResponse, imagePayload), true)
      return false
    }
    groups = groupPayload.groups
    images = imagePayload.images
    for (const id of selected) if (!images.some((image) => image.id === id)) selected.delete(id)
    render()
    return true
  }

  createForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    const name = createForm.querySelector('input[name="name"]').value
    busy = true
    createForm.querySelector('[type="submit"]').disabled = true
    setStatus(createStatus, 'Creating folder…')
    try {
      const [response, payload] = await requestJson('POST', '/api/media/groups', { name })
      if (!section.isConnected) return
      if (!response.ok) setStatus(createStatus, responseError(response, payload), true)
      else {
        createDialog.close()
        if (await refresh()) notify('Folder created.')
        else notify('Folder created, but the shared library could not reload.', 'error')
      }
    } catch {
      if (section.isConnected) {
        if (createDialog.open) setStatus(createStatus, 'Could not create folder.', true)
        else notify('Folder created, but could not reload folders.', 'error')
      }
    } finally {
      busy = false
      createForm.querySelector('[type="submit"]').disabled = false
      if (section.isConnected) render()
    }
  })
  createDialog?.addEventListener('cancel', (event) => { if (busy) event.preventDefault() })
  createDialog?.querySelector('[data-cancel]').addEventListener('click', () => {
    if (!busy) createDialog.close()
  })

  moveButton?.addEventListener('click', () => {
    if (busy || !selected.size) return
    renderDestinations()
    moveCount.textContent = `${selected.size} image${selected.size === 1 ? '' : 's'} selected`
    setStatus(moveStatus, '')
    moveConfirm.disabled = true
    moveDialog.showModal()
  })
  moveForm?.addEventListener('change', () => { moveConfirm.disabled = busy })
  moveForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const destination = moveForm.querySelector('input[name="group_id"]:checked')
    if (busy || !selected.size || !destination) return
    const groupId = destination.value === '' ? null : Number(destination.value)
    busy = true
    moveConfirm.disabled = true
    moveCancel.disabled = true
    setStatus(moveStatus, `Moving ${selected.size} images…`)
    render()
    let moved = 0
    let error = ''
    for (const id of [...selected]) {
      try {
        const [response, payload] = await requestJson('PATCH', `${imageUrl(id)}/group`, { group_id: groupId })
        if (!section.isConnected) return
        if (!response.ok) { error = responseError(response, payload); break }
        selected.delete(id)
        moved++
      } catch { error = 'Could not move image.'; break }
    }
    if (section.isConnected) {
      try {
        if (!await refresh()) error ||= 'Could not reload shared library.'
      } catch { error ||= 'Could not reload shared library.' }
      moveDialog.close()
      notify(error ? `${moved} moved. ${error}` : `${moved} image${moved === 1 ? '' : 's'} moved.`,
        error ? (moved ? 'warning' : 'error') : 'success')
      if (!error) setStatus(status, '')
    }
    busy = false
    moveCancel.disabled = false
    if (section.isConnected) render()
  })

  moveDialog?.addEventListener('cancel', (event) => { if (busy) event.preventDefault() })
  moveCancel?.addEventListener('click', () => { if (!busy) moveDialog.close() })
  refresh().then((ok) => { if (ok && section.isConnected) setStatus(status, '') })
    .catch(() => { if (section.isConnected) setStatus(status, 'Could not load shared library.', true) })
  return { refresh }
}
