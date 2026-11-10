import { formatBytes } from '../../shared/format.js'

const downloadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/></svg>'

export function renderBackups(app, { requestJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="backups-page">
      <h1 class="section-title">Backups</h1>
      <p class="backups-description">Each download contains the verified auth, quiz, media, and Musico database archives.</p>
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
      sizeCell.textContent = formatBytes(backup.size_bytes, { minimumUnit: 'KiB', roundUp: true })
      const downloadCell = document.createElement('td')
      const download = document.createElement('a')
      download.className = 'backup-download'
      download.href = `/api/auth/backups/${encodeURIComponent(backup.id)}/download`
      download.innerHTML = downloadIcon
      download.setAttribute('aria-label', `Download backup from ${date.textContent}`)
      download.title = 'Download ZIP'
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
