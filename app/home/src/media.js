const imageUrl = (id) => `/api/media/images/${id}`
import { renderSharedMedia } from './shared-media.js'
import { formatBytes, formatImageDetails } from './media-format.js'
import { selectImageRange } from './media-selection.js'
import { createPageNotice } from '../../shared/page-notice.js'

export function renderMedia(app, { currentUser, requestJson, responseError, setStatus }) {
  app.querySelector('#page').innerHTML = `
    <main class="media-page">
      <div class="media-header">
        <div><h1 class="section-title">Media</h1><p>Your images and the shared library.</p></div>
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
    </main>
  `
  const page = app.querySelector('.media-page')
  const notice = createPageNotice(page)
  const grid = page.querySelector('#media-grid')
  const usage = page.querySelector('#media-usage')
  const status = page.querySelector('#media-status')
  const fileInput = page.querySelector('#media-file')
  const upload = page.querySelector('#media-upload')
  const publish = page.querySelector('#media-publish')
  const selected = new Set()
  let selectionAnchor = null
  const sharedMedia = renderSharedMedia(page.querySelector('#shared-media'), {
    currentUser, requestJson, responseError, setStatus, notify: notice.show,
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
      if (publish && image.scope === 'personal') {
        const label = document.createElement('label')
        label.className = 'media-select'
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.dataset.imageSelect = String(image.id)
        checkbox.checked = selected.has(image.id)
        checkbox.disabled = busy
        checkbox.addEventListener('click', (event) => {
          selectionAnchor = selectImageRange(event, image.id, images.map((item) => item.id),
            selected, selectionAnchor, grid)
          updatePublishButton()
        })
        label.append(checkbox, document.createTextNode('Select to share'))
        card.append(label)
      }
      grid.append(card)
    }
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
