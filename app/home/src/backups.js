function formatSize(bytes) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GiB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MiB`
  return `${Math.ceil(bytes / 1024)} KiB`
}

export function renderBackups(app, { requestJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="backups-page">
      <h1 class="section-title">Backups</h1>
      <p class="backups-description">Each download contains the verified auth, quiz, and media database archives.</p>
      <p id="backups-status" class="form-status" role="status" aria-live="polite">Loading backups…</p>
      <div id="backups-table-wrap" class="backups-table-wrap" hidden>
        <table class="backups-table">
          <thead><tr><th scope="col">Created</th><th scope="col">Size</th><th scope="col">Download</th></tr></thead>
          <tbody id="backups-list"></tbody>
        </table>
      </div>
    </main>
  `
  const status = page.querySelector('#backups-status')
  const tableWrap = page.querySelector('#backups-table-wrap')
  const list = page.querySelector('#backups-list')
  requestJson('GET', '/api/auth/backups').then(([response, payload]) => {
    if (!app.contains(list)) return
    if (!response.ok) {
      setStatus(status, responseError(response, payload), true)
      return
    }
    if (!Array.isArray(payload?.backups)) {
      setStatus(status, 'Could not load backups. Please try again.', true)
      return
    }
    for (const backup of payload.backups) {
      const row = document.createElement('tr')
      const dateCell = document.createElement('td')
      const date = document.createElement('time')
      date.dateTime = backup.created
      date.textContent = new Date(backup.created).toLocaleString()
      dateCell.append(date)
      const sizeCell = document.createElement('td')
      sizeCell.textContent = formatSize(backup.size_bytes)
      const downloadCell = document.createElement('td')
      const download = document.createElement('a')
      download.className = 'auth-button auth-button-secondary backup-download'
      download.href = `/api/auth/backups/${encodeURIComponent(backup.id)}/download`
      download.textContent = 'Download ZIP'
      download.setAttribute('aria-label', `Download backup from ${date.textContent}`)
      downloadCell.append(download)
      row.append(dateCell, sizeCell, downloadCell)
      list.append(row)
    }
    tableWrap.hidden = payload.backups.length === 0
    setStatus(status, payload.backups.length ? '' : 'No complete backups are available yet.')
  }).catch(() => {
    if (app.contains(list)) setStatus(status, 'Could not load backups. Please try again.', true)
  })
}
