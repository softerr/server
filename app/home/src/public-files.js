import { formatBytes } from './media-format.js'

export function renderPublicFiles(section, { requestJson, responseError, setStatus, notify }) {
  section.innerHTML = `
    <div class="media-personal-header">
      <div class="media-usage" aria-live="polite"><div class="media-usage-row">
        <div class="media-usage-label"><span>Public file storage</span><span data-usage></span></div>
        <progress data-bar aria-label="Public file storage used"></progress>
      </div><p class="media-usage-limit" data-limit></p></div>
      <button type="button" class="auth-button auth-button-secondary" data-upload>Upload files</button>
      <input data-files type="file" multiple hidden>
    </div>
    <p>Anyone with a file link can download it.</p>
    <div class="public-file-list" data-list></div>
    <p class="form-status" data-status role="status" aria-live="polite">Loading files…</p>
  `
  const list = section.querySelector('[data-list]')
  const status = section.querySelector('[data-status]')
  const upload = section.querySelector('[data-upload]')
  const input = section.querySelector('[data-files]')
  let items = []
  let search = ''
  let busy = false

  function render() {
    list.replaceChildren()
    const visible = items.filter((item) => item.name.toLocaleLowerCase().includes(search))
    if (!visible.length) {
      const empty = document.createElement('p')
      empty.className = 'media-empty'
      empty.textContent = search ? 'No files match your search.' : 'No public files yet.'
      list.append(empty)
    }
    for (const item of visible) {
      const row = document.createElement('div')
      row.className = 'public-file-row'
      const details = document.createElement('div')
      details.className = 'public-file-details'
      const link = document.createElement('a')
      link.href = item.url
      link.textContent = item.name
      link.title = new URL(item.url, location.origin).href
      link.target = '_blank'
      link.rel = 'noopener'
      const size = document.createElement('span')
      size.textContent = formatBytes(item.size_bytes)
      details.append(link, size)
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'auth-button auth-button-secondary'
      copy.textContent = 'Copy link'
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(new URL(item.url, location.origin).href)
          notify('Link copied.', 'success')
        } catch { notify('Could not copy link.', 'error') }
      })
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'auth-button auth-button-secondary'
      remove.textContent = 'Delete'
      remove.disabled = busy
      remove.addEventListener('click', async () => {
        if (busy || !window.confirm(`Delete ${item.name}? Its public link will stop working.`)) return
        busy = true
        remove.disabled = true
        try {
          const [response, payload] = await requestJson('DELETE', `/api/media/files/${item.id}`)
          if (!response.ok) notify(responseError(response, payload), 'error')
          else { notify('File deleted.', 'success'); await refresh() }
        } catch { notify('Could not delete file.', 'error') }
        busy = false
        render()
      })
      row.append(details, copy, remove)
      list.append(row)
    }
  }

  async function refresh() {
    const [response, payload] = await requestJson('GET', '/api/media/files')
    if (!section.isConnected) return
    if (!response.ok || !Array.isArray(payload?.files)) {
      setStatus(status, responseError(response, payload), true)
      return
    }
    items = payload.files
    section.querySelector('[data-usage]').textContent = `${formatBytes(payload.usage.bytes)} / ${formatBytes(payload.limits.bytes)}`
    const bar = section.querySelector('[data-bar]')
    bar.max = payload.limits.bytes
    bar.value = payload.usage.bytes
    section.querySelector('[data-limit]').textContent = `${formatBytes(payload.limits.per_file_bytes)} max per file · ${payload.usage.count} / ${payload.limits.count} files`
    setStatus(status, '')
    render()
  }

  upload.addEventListener('click', () => { if (!busy) input.click() })
  input.addEventListener('change', async () => {
    const files = [...input.files]
    input.value = ''
    if (!files.length || busy) return
    busy = true
    upload.disabled = true
    let uploaded = 0
    const errors = []
    for (const file of files) {
      try {
        const response = await fetch('/api/media/files', {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
        })
        const payload = await response.json().catch(() => null)
        if (response.ok) uploaded++
        else errors.push(`${file.name}: ${responseError(response, payload)}`)
      } catch { errors.push(`${file.name}: upload failed`) }
    }
    busy = false
    upload.disabled = false
    await refresh()
    notify(`${uploaded} file${uploaded === 1 ? '' : 's'} uploaded${errors.length ? `. ${errors.length} failed: ${errors[0]}` : '.'}`,
      errors.length ? (uploaded ? 'warning' : 'error') : 'success')
  })
  refresh().catch(() => setStatus(status, 'Could not load files.', true))
  return { setSearch(value) { search = value.toLocaleLowerCase(); render() } }
}
