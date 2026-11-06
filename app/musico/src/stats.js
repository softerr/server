import { status } from './view-ui.js'
import { loadJson } from './api.js'
import { exportLibrary, importLibrary } from './library-data.js'

export function renderStats(app, { requestJson, responseError }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="musico-page">
      <h1 class="section-title">Stats</h1>
      <p id="musico-status" class="form-status" role="status" aria-live="polite">Loading stats…</p>
      <div class="musico-stats-grid">
        <div class="musico-stat"><span>Total listen time</span><strong id="stat-time">—</strong></div>
        <div class="musico-stat"><span>Total plays</span><strong id="stat-plays">—</strong></div>
        <div class="musico-stat"><span>Most played song</span><strong id="stat-top">—</strong></div>
      </div>
      <h2>Listening by song</h2>
      <ul id="stat-songs" class="musico-list"></ul>
      <h2>Accent color</h2>
      <div id="accent-choices" class="musico-accent-choices" role="group" aria-label="Accent color"></div>
      <h2>Library data</h2>
      <p class="musico-hint">Export song metadata, listening stats, and playlists as JSON. Audio files are not included.</p>
      <div class="musico-data-actions"><button id="export-library" type="button" class="auth-button auth-button-secondary">Export JSON</button><label class="auth-button auth-button-secondary musico-upload">Import JSON<input id="import-library" type="file" accept="application/json,.json" hidden></label></div>
      <p id="library-data-status" class="form-status" role="status" aria-live="polite"></p>
    </main>
  `
  const statusElement = page.querySelector('#musico-status')
  const choices = page.querySelector('#accent-choices')
  const dataStatus = page.querySelector('#library-data-status')
  page.querySelector('#export-library').addEventListener('click', async (event) => {
    const control = event.currentTarget
    control.disabled = true
    status(dataStatus, 'Preparing library JSON…')
    try {
      await exportLibrary(requestJson, responseError)
      status(dataStatus, 'Library JSON downloaded.')
    } catch (error) { status(dataStatus, error.message, true) }
    finally { control.disabled = false }
  })
  page.querySelector('#import-library').addEventListener('change', async (event) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!window.confirm('Import metadata for matching uploaded songs and add saved playlists?')) return
    input.disabled = true
    try {
      const result = await importLibrary(file, requestJson, responseError, (message) => status(dataStatus, message))
      status(dataStatus, `${result.updated} songs updated, ${result.created} playlists created, ${result.added} songs added to playlists.`)
    } catch (error) { status(dataStatus, error.message, true) }
    finally { input.disabled = false }
  })
  for (const [name, color] of Object.entries({ Orange: '#d08b38', Red: '#c56464', Blue: '#6d92c5', Green: '#7ca478', Purple: '#9b7ac1', Pink: '#c77fa6', Teal: '#65aaa3' })) {
    const choice = document.createElement('button')
    choice.type = 'button'
    choice.className = 'musico-accent-choice'
    choice.style.backgroundColor = color
    choice.title = name
    choice.setAttribute('aria-label', `${name} accent`)
    choice.setAttribute('aria-pressed', (localStorage.getItem('musico-accent') || '#d08b38') === color ? 'true' : 'false')
    choice.addEventListener('click', () => {
      localStorage.setItem('musico-accent', color)
      document.documentElement.style.setProperty('--accent', color)
      for (const item of choices.children) item.setAttribute('aria-pressed', item === choice ? 'true' : 'false')
    })
    choices.append(choice)
  }
  loadJson(requestJson, 'GET', '/api/musico/tracks', undefined, responseError).then((payload) => {
    if (!app.contains(page)) return
    const tracks = payload.tracks ?? []
    const totalMs = tracks.reduce((sum, track) => sum + track.listen_ms, 0)
    const totalPlays = tracks.reduce((sum, track) => sum + track.play_count, 0)
    const mostPlayed = [...tracks].sort((a, b) => b.play_count - a.play_count)[0]
    page.querySelector('#stat-time').textContent = `${Math.floor(totalMs / 3600000)}h ${Math.floor(totalMs % 3600000 / 60000)}m`
    page.querySelector('#stat-plays').textContent = String(totalPlays)
    page.querySelector('#stat-top').textContent = mostPlayed?.play_count ? `${mostPlayed.title} (${mostPlayed.play_count})` : '—'
    const list = page.querySelector('#stat-songs')
    for (const track of [...tracks].sort((a, b) => b.listen_ms - a.listen_ms)) {
      const row = document.createElement('li')
      row.className = 'musico-row'
      const name = document.createElement('strong')
      name.textContent = track.title
      const detail = document.createElement('span')
      detail.textContent = `${track.play_count} plays · ${Math.floor(track.listen_ms / 60000)} min listened`
      row.append(name, detail)
      list.append(row)
    }
    status(statusElement, '')
  }).catch((error) => { if (app.contains(page)) status(statusElement, error.message, true) })
}

