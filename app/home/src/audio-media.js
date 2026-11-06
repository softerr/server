import { formatBytes } from './media-format.js'
import { bindMediaCardSelection, updateMediaCardSelection } from './media-selection.js'

const audioIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>'

export function renderAudioMedia(section, { requestJson, responseError, setStatus, notify }) {
  section.innerHTML = `
    <div class="media-personal-header">
      <div class="media-usage" aria-live="polite"><div class="media-usage-row">
        <div class="media-usage-label"><span>Audio storage</span><span data-audio-usage></span></div>
        <progress data-audio-bar aria-label="Audio storage used"></progress>
      </div><p class="media-usage-limit" data-audio-limit></p></div>
      <button type="button" class="auth-button auth-button-secondary" data-upload>Upload audio</button>
      <input data-files type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/flac,audio/mp4,.mp3,.ogg,.wav,.flac,.m4a" multiple hidden>
    </div>
    <div class="media-grid" data-grid></div>
    <div class="media-selection-actions"><button type="button" class="auth-button auth-button-secondary" data-delete-selected disabled>Delete selected</button></div>
    <p class="form-status" data-status role="status" aria-live="polite">Loading audio…</p>
    <dialog class="user-dialog" data-delete-dialog aria-labelledby="audio-delete-title"><div class="media-audio-dialog-content">
      <h2 id="audio-delete-title">Delete selected audio?</h2>
      <p data-delete-name></p><p>Files used by Musico songs must be removed from Musico first.</p>
      <p class="form-status" data-delete-status role="status"></p>
      <div class="user-dialog-actions"><button type="button" class="auth-button auth-button-secondary" data-cancel>Cancel</button><button type="button" class="auth-button auth-button-primary" data-confirm>Delete selected</button></div>
    </div></dialog>
  `
  const grid = section.querySelector('[data-grid]')
  const status = section.querySelector('[data-status]')
  const upload = section.querySelector('[data-upload]')
  const files = section.querySelector('[data-files]')
  const dialog = section.querySelector('[data-delete-dialog]')
  const deleteButton = section.querySelector('[data-delete-selected]')
  const confirmDelete = section.querySelector('[data-confirm]')
  const deleteStatus = section.querySelector('[data-delete-status]')
  let audio = []
  let search = ''
  let busy = false
  const selected = new Set()
  const anchor = { id: null }
  let pendingDelete = []

  function updateSelection() {
    updateMediaCardSelection(grid, selected)
    deleteButton.disabled = busy || selected.size === 0
    deleteButton.textContent = selected.size ? `Delete ${selected.size} selected` : 'Delete selected'
  }

  function render() {
    grid.replaceChildren()
    const visible = audio.filter((file) => file.name.toLocaleLowerCase().includes(search))
    if (!visible.length) {
      const empty = document.createElement('p')
      empty.className = 'media-empty'
      empty.textContent = search ? 'No audio matches your search.' : 'No audio files yet.'
      grid.append(empty)
    }
    for (const file of visible) {
      const card = document.createElement('article')
      card.className = 'media-card media-audio-card'
      const icon = document.createElement('div')
      icon.className = 'media-audio-icon'
      icon.innerHTML = audioIcon
      const details = document.createElement('div')
      details.className = 'media-card-details'
      const name = document.createElement('span')
      name.className = 'media-card-name'
      name.textContent = file.name
      name.title = file.name
      const meta = document.createElement('span')
      meta.className = 'media-card-meta'
      meta.textContent = formatBytes(file.size_bytes)
      const player = document.createElement('audio')
      player.controls = true
      player.preload = 'none'
      player.src = `/api/media/audio/${file.id}`
      player.setAttribute('aria-label', `Play ${file.name}`)
      details.append(name, meta, player)
      card.append(icon, details)
      bindMediaCardSelection(card, file, {
        grid, selected, anchor, visibleIds: () => visible.map((item) => item.id),
        busy: () => busy, changed: updateSelection,
      })
      grid.append(card)
    }
    updateSelection()
  }

  async function refresh() {
    const [response, payload] = await requestJson('GET', '/api/media/audio')
    if (!section.isConnected) return
    if (!response.ok || !Array.isArray(payload?.audio)) {
      setStatus(status, responseError(response, payload), true)
      return
    }
    audio = payload.audio
    for (const id of selected) if (!audio.some((file) => file.id === id)) selected.delete(id)
    section.querySelector('[data-audio-usage]').textContent = `${formatBytes(payload.usage.bytes)} / ${formatBytes(payload.limits.bytes)}`
    const bar = section.querySelector('[data-audio-bar]')
    bar.max = payload.limits.bytes
    bar.value = payload.usage.bytes
    section.querySelector('[data-audio-limit]').textContent = `${formatBytes(payload.limits.per_file_bytes)} max per file`
    setStatus(status, '')
    render()
  }

  upload.addEventListener('click', () => { if (!busy) files.click() })
  files.addEventListener('change', async () => {
    const selected = [...files.files]
    files.value = ''
    if (!selected.length || busy) return
    busy = true
    upload.disabled = true
    let uploaded = 0
    const errors = []
    for (const file of selected) {
      try {
        const response = await fetch('/api/media/audio', {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Name': encodeURIComponent(file.name) }, body: file,
        })
        const payload = await response.json().catch(() => null)
        if (response.ok) uploaded++
        else errors.push(`${file.name}: ${responseError(response, payload)}`)
      } catch { errors.push(`${file.name}: upload failed`) }
    }
    busy = false
    upload.disabled = false
    if (!section.isConnected) return
    await refresh()
    notify(`${uploaded} audio file${uploaded === 1 ? '' : 's'} uploaded${errors.length ? `. ${errors.length} failed: ${errors[0]}` : '.'}`,
      errors.length ? (uploaded ? 'warning' : 'error') : 'success')
  })
  deleteButton.addEventListener('click', () => {
    if (busy || !selected.size) return
    pendingDelete = audio.filter((file) => selected.has(file.id))
    const used = pendingDelete.filter((file) => file.musico_song_ids.length)
    section.querySelector('[data-delete-name]').textContent = used.length
      ? `${used.map((file) => `${file.name} (song ${file.musico_song_ids.join(', ')})`).join('; ')} cannot be deleted while used by Musico.`
      : `Delete ${pendingDelete.length} selected audio file${pendingDelete.length === 1 ? '' : 's'}?`
    confirmDelete.disabled = used.length > 0
    setStatus(deleteStatus, '')
    dialog.showModal()
  })
  section.querySelector('[data-cancel]').addEventListener('click', () => dialog.close())
  confirmDelete.addEventListener('click', async () => {
    if (!pendingDelete.length || busy) return
    busy = true
    try {
      const failures = []
      let deleted = 0
      for (const file of pendingDelete) {
        const [response, payload] = await requestJson('DELETE', `/api/media/audio/${file.id}`)
        if (!section.isConnected) return
        if (response.ok) { selected.delete(file.id); deleted++ }
        else failures.push(`${file.name}: ${responseError(response, payload)}`)
      }
      dialog.close()
      await refresh()
      notify(`${deleted} audio file${deleted === 1 ? '' : 's'} deleted${failures.length ? `. ${failures[0]}` : '.'}`,
        failures.length ? (deleted ? 'warning' : 'error') : 'success')
    } catch { if (section.isConnected) setStatus(deleteStatus, 'Could not delete audio file.', true) }
    finally { busy = false; updateSelection() }
  })
  refresh().catch(() => { if (section.isConnected) setStatus(status, 'Could not load audio.', true) })
  return { setSearch(value) { search = value.trim().toLocaleLowerCase(); render() }, refresh }
}
