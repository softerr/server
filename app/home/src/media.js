const imageUrl = (id) => `/api/media/images/${id}`
import { renderSharedMedia, renameIcon } from './shared-media.js'
import { formatBytes, formatImageDetails, mediaImageIcon } from './media-format.js'
import { bindMediaCardSelection, updateMediaCardSelection } from './media-selection.js'
import { createPageNotice } from '../../shared/page-notice.js'

const viewOptions = [
  ['list', 'List', '<rect x="3" y="4" width="4" height="4"/><path d="M10 6h11"/><rect x="3" y="10" width="4" height="4"/><path d="M10 12h11"/><rect x="3" y="16" width="4" height="4"/><path d="M10 18h11"/>'],
  ['small', 'Small icons', '<path d="M3 3h4v4H3zM10 3h4v4h-4zM17 3h4v4h-4zM3 10h4v4H3zM10 10h4v4h-4zM17 10h4v4h-4zM3 17h4v4H3zM10 17h4v4h-4zM17 17h4v4h-4z"/>'],
  ['medium', 'Medium icons', '<path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/>'],
  ['large', 'Large icons', '<rect x="3" y="3" width="18" height="18" rx="1"/>'],
]

export function renderMedia(app, { currentUser, requestJson, responseError, setStatus }) {
  const viewButtonsMarkup = viewOptions.map(([value, label, shapes]) =>
    `<button class="media-view-button" type="button" data-media-layout-option="${value}" aria-label="${label} view" title="${label} view" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg></button>`).join('')
  app.querySelector('#page').innerHTML = `
    <main class="media-page">
      <div class="media-header">
        <h1 class="section-title">Media</h1>
        <div class="media-view-control" role="group" aria-label="Media view">${viewButtonsMarkup}</div>
      </div>
      <div class="media-tabs" role="tablist" aria-label="Media libraries">
        <button id="media-tab-personal" class="media-tab" type="button" role="tab" aria-controls="media-personal" aria-selected="true">My library</button>
        <button id="media-tab-shared" class="media-tab" type="button" role="tab" aria-controls="shared-media" aria-selected="false" tabindex="-1">Shared library</button>
      </div>
      <section id="media-personal" class="media-panel" role="tabpanel" aria-labelledby="media-tab-personal" tabindex="0">
        <div class="media-personal-header">
          <div id="media-usage" class="media-usage" aria-live="polite" hidden>
            <div class="media-usage-row">
              <div class="media-usage-label"><span>Images</span><span data-image-count></span></div>
              <progress data-image-count-bar aria-label="Personal images used"></progress>
            </div>
            <div class="media-usage-row">
              <div class="media-usage-label"><span>Storage</span><span data-image-storage></span></div>
              <progress data-image-storage-bar aria-label="Personal image storage used"></progress>
            </div>
            <p class="media-usage-limit" data-image-per-limit></p>
          </div>
          <button type="button" class="auth-button auth-button-secondary media-upload" id="media-upload">Upload images</button>
          <input id="media-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
        </div>
        <div id="media-grid" class="media-grid"></div>
        ${currentUser.role === 'admin' ? '<button id="media-publish" type="button" class="auth-button auth-button-primary" disabled>Make selected shared</button>' : ''}
        <p id="media-status" class="form-status" role="status" aria-live="polite">Loading images…</p>
      </section>
      <section id="shared-media" class="shared-media media-panel" role="tabpanel" aria-labelledby="media-tab-shared" tabindex="0" hidden></section>
      <dialog id="media-rename-dialog" class="user-dialog" aria-labelledby="media-rename-title"><form id="media-rename-form"><h2 id="media-rename-title">Rename image</h2><label class="field"><span>Filename</span><input name="name" maxlength="255" required></label><p id="media-rename-status" class="form-status" role="status" aria-live="polite"></p><div class="user-dialog-actions"><button type="button" class="auth-button auth-button-secondary" data-cancel>Cancel</button><button type="submit" class="auth-button auth-button-primary">Save name</button></div></form></dialog>
    </main>
  `
  const page = app.querySelector('.media-page')
  const viewButtons = [...page.querySelectorAll('.media-view-button')]
  const viewStorageKey = 'softerr-media-view'
  let savedView = null
  try { savedView = localStorage.getItem(viewStorageKey) } catch { /* Storage may be unavailable. */ }
  function setView(view, save = false) {
    page.dataset.mediaLayout = view
    for (const button of viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mediaLayoutOption === view))
    }
    for (const preview of page.querySelectorAll('.media-card > img')) {
      if (view === 'list') preview.removeAttribute('src')
      else preview.src = preview.dataset.src
    }
    if (save) {
      try { localStorage.setItem(viewStorageKey, view) } catch { /* Keep this view for the current page. */ }
    }
  }
  setView(viewOptions.some(([value]) => value === savedView) ? savedView : 'medium')
  for (const button of viewButtons) {
    button.addEventListener('click', () => setView(button.dataset.mediaLayoutOption, true))
  }
  const notice = createPageNotice(page)
  const grid = page.querySelector('#media-grid')
  const usage = page.querySelector('#media-usage')
  const status = page.querySelector('#media-status')
  const fileInput = page.querySelector('#media-file')
  const upload = page.querySelector('#media-upload')
  const publish = page.querySelector('#media-publish')
  const renameDialog = page.querySelector('#media-rename-dialog')
  const renameForm = page.querySelector('#media-rename-form')
  const renameStatus = page.querySelector('#media-rename-status')
  const selected = new Set()
  const selectionAnchor = { id: null }
  const sharedMedia = renderSharedMedia(page.querySelector('#shared-media'), {
    currentUser, requestJson, responseError, setStatus, notify: notice.show, renameImage: openRename,
  })
  const tabs = [...page.querySelectorAll('.media-tab')]
  const personalPanel = page.querySelector('#media-personal')
  const sharedPanel = page.querySelector('#shared-media')
  function selectTab(index) {
    for (const [position, tab] of tabs.entries()) {
      const active = position === index
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    }
    personalPanel.hidden = index !== 0
    sharedPanel.hidden = index !== 1
  }
  tabs.forEach((tab, index) => tab.addEventListener('click', () => selectTab(index)))
  page.querySelector('.media-tabs').addEventListener('keydown', (event) => {
    const current = tabs.indexOf(document.activeElement)
    if (current < 0) return
    let next = current
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    selectTab(next)
    tabs[next].focus()
  })
  let images = []
  let busy = false
  let renaming = null
  let renameBusy = false

  function openRename(image, refreshLibrary) {
    if (renameBusy) return
    renaming = { image, refreshLibrary }
    renameForm.elements.name.value = image.name
    setStatus(renameStatus, '')
    renameDialog.showModal()
    renameForm.elements.name.focus()
    renameForm.elements.name.select()
  }

  renameForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (renameBusy || !renaming) return
    const { image, refreshLibrary } = renaming
    const name = renameForm.elements.name.value
    if (name === image.name) { renameDialog.close(); return }
    renameBusy = true
    renameForm.querySelector('[type="submit"]').disabled = true
    setStatus(renameStatus, 'Renaming image…')
    try {
      const [response, payload] = await requestJson('PATCH', imageUrl(image.id), { name })
      if (!page.isConnected) return
      if (!response.ok) setStatus(renameStatus, responseError(response, payload), true)
      else {
        renameDialog.close()
        try {
          if (await refreshLibrary()) notice.show('Image renamed.')
          else notice.show('Image renamed, but the library could not reload.', 'error')
        } catch { notice.show('Image renamed, but the library could not reload.', 'error') }
      }
    } catch {
      if (page.isConnected) setStatus(renameStatus, 'Could not rename image.', true)
    } finally {
      renameBusy = false
      renameForm.querySelector('[type="submit"]').disabled = false
    }
  })
  renameDialog.addEventListener('cancel', (event) => { if (renameBusy) event.preventDefault() })
  renameForm.querySelector('[data-cancel]').addEventListener('click', () => {
    if (!renameBusy) renameDialog.close()
  })

  function updatePublishButton() {
    if (!publish) return
    publish.disabled = busy || selected.size === 0
    publish.textContent = selected.size ? `Make ${selected.size} selected shared` : 'Make selected shared'
  }

  function render() {
    grid.replaceChildren()
    if (!images.length) {
      const empty = document.createElement('p')
      empty.className = 'media-empty'
      empty.textContent = 'You have not uploaded any images yet.'
      grid.append(empty)
    }
    for (const image of images) {
      const card = document.createElement('article')
      card.className = 'media-card'
      const preview = document.createElement('img')
      preview.dataset.src = imageUrl(image.id)
      if (page.dataset.mediaLayout !== 'list') preview.src = preview.dataset.src
      preview.alt = image.name
      preview.loading = 'lazy'
      const listIcon = document.createElement('span')
      listIcon.className = 'media-list-image-icon'
      listIcon.setAttribute('aria-hidden', 'true')
      listIcon.innerHTML = mediaImageIcon
      const details = document.createElement('div')
      details.className = 'media-card-details'
      const name = document.createElement('span')
      name.className = 'media-card-name'
      name.textContent = image.name
      name.title = image.name
      const metadata = document.createElement('span')
      metadata.className = 'media-card-meta'
      metadata.textContent = formatImageDetails(image)
      const title = document.createElement('div')
      title.className = 'media-card-title'
      const rename = document.createElement('button')
      rename.type = 'button'
      rename.className = 'media-rename-button'
      rename.innerHTML = renameIcon
      rename.setAttribute('aria-label', `Rename ${image.name}`)
      rename.title = `Rename ${image.name}`
      rename.disabled = busy
      rename.addEventListener('click', () => openRename(image, refresh))
      title.append(name, rename)
      details.append(title, metadata)
      card.append(preview, listIcon, details)
      if (publish && image.scope === 'personal') bindMediaCardSelection(card, image, {
        grid, selected, anchor: selectionAnchor, visibleIds: () => images.map((item) => item.id),
        busy: () => busy, changed: updatePublishButton,
      })
      grid.append(card)
    }
    updateMediaCardSelection(grid, selected)
    updatePublishButton()
  }

  async function refresh() {
    const [response, payload] = await requestJson('GET', '/api/media/my-images')
    if (!page.isConnected) return false
    if (!response.ok || !Array.isArray(payload?.images)) {
      usage.hidden = true
      setStatus(status, responseError(response, payload), true)
      return false
    }
    images = payload.images
    for (const id of selected) {
      if (!images.some((image) => image.id === id && image.scope === 'personal')) selected.delete(id)
    }
    usage.querySelector('[data-image-count]').textContent = `${payload.usage.count} / ${payload.limits.count}`
    const countBar = usage.querySelector('[data-image-count-bar]')
    countBar.max = payload.limits.count
    countBar.value = payload.usage.count
    usage.querySelector('[data-image-storage]').textContent = `${formatBytes(payload.usage.bytes)} / ${formatBytes(payload.limits.bytes)}`
    const storageBar = usage.querySelector('[data-image-storage-bar]')
    storageBar.max = payload.limits.bytes
    storageBar.value = payload.usage.bytes
    usage.querySelector('[data-image-per-limit]').textContent = `${formatBytes(payload.limits.per_image_bytes)} max per image`
    usage.hidden = false
    render()
    return true
  }

  upload.addEventListener('click', () => { if (!busy) fileInput.click() })
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || [])
    fileInput.value = ''
    if (!files.length || busy) return
    busy = true
    upload.disabled = true
    render()
    let ready = 0
    let shared = 0
    const failures = []
    try {
      for (const [index, file] of files.entries()) {
        if (!page.isConnected) return
        notice.show(`Uploading ${index + 1} of ${files.length}: ${file.name}…`, 'info')
        if (file.size > 2097152) {
          failures.push(`${file.name}: image must be at most 2 MiB`)
          continue
        }
        try {
          const response = await fetch('/api/media/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Image-Name': encodeURIComponent(file.name) },
            body: file,
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) {
            failures.push(`${file.name}: ${responseError(response, payload)}`)
            continue
          }
          if (payload?.scope === 'shared') shared++
          else ready++
        } catch {
          failures.push(`${file.name}: could not upload`)
        }
      }
      if (!page.isConnected) return
      const refreshed = await refresh()
      if (!refreshed) {
        notice.show('Uploads finished, but your library could not be reloaded.', 'error')
        return
      }
      const summary = [`${ready} ready in your library`]
      if (shared) summary.push(`${shared} already shared`)
      if (failures.length) {
        const details = failures.slice(0, 3).join('; ')
        summary.push(`${failures.length} failed (${details}${failures.length > 3 ? '; more…' : ''})`)
      }
      notice.show(summary.join(' · '), failures.length ? (ready || shared ? 'warning' : 'error') : 'success')
      setStatus(status, '')
    } catch {
      if (page.isConnected) notice.show('Could not reload your images after uploading.', 'error')
    } finally {
      busy = false
      upload.disabled = false
      if (page.isConnected) render()
    }
  })

  publish?.addEventListener('click', async () => {
    if (busy || !selected.size) return
    busy = true
    render()
    notice.show(`Publishing ${selected.size} selected images…`, 'info')
    let completed = 0
    let error = ''
    for (const id of [...selected]) {
      try {
        const [response, payload] = await requestJson('POST', `${imageUrl(id)}/publish`)
        if (!page.isConnected) return
        if (!response.ok) {
          error = responseError(response, payload)
          break
        }
        selected.delete(id)
        completed++
      } catch {
        error = 'Could not publish image. Please try again.'
        break
      }
    }
    if (!page.isConnected) return
    busy = false
    try {
      const results = await Promise.all([refresh(), sharedMedia.refresh()])
      if (results.includes(false)) error ||= 'Could not reload images.'
    } catch { error ||= 'Could not reload images.' }
    notice.show(error ? `${completed} published. ${error}` : `${completed} image${completed === 1 ? '' : 's'} made shared.`,
      error ? (completed ? 'warning' : 'error') : 'success')
    if (!error) setStatus(status, '')
  })

  refresh().then((ok) => {
    if (ok && page.isConnected) setStatus(status, '')
  }).catch(() => {
    if (page.isConnected) setStatus(status, 'Could not load images.', true)
  })
}
