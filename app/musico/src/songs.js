import { musicPlayer, status, formatAudioBytes, renderTrackRow, songDetailsUrl, ready } from './view-ui.js'
import { loadJson, versionHeader } from './api.js'

const MAX_TRACK_BYTES = 24 * 1024 * 1024

export function renderSongs(app, { requestJson, responseError }) {
  const page = app.querySelector('#page')
  const playback = musicPlayer(requestJson)
  page.innerHTML = `
    <main class="musico-page">
      <div class="musico-heading">
        <h1 class="section-title">Songs</h1>
        <div id="musico-usage" class="musico-usage" aria-live="polite" hidden>
          <div class="musico-usage-label"><span>Storage</span><span data-storage-usage></span></div>
          <progress data-storage-bar aria-label="Audio storage used"></progress>
        </div>
        <label class="auth-button auth-button-primary musico-upload">Upload audio
          <input id="audio-upload" type="file" accept=".mp3,.ogg,.wav,.flac,.m4a,audio/*" multiple hidden>
        </label>
      </div>
      <p class="musico-hint">MP3, Ogg, WAV, FLAC, or M4A<span id="musico-file-limit"></span></p>
      <div class="musico-library-tools">
        <input id="song-query" type="search" placeholder="Search title or artist" aria-label="Search songs" autocomplete="off">
        <select id="song-artist" aria-label="Filter by artist"><option value="">All artists</option></select>
        <select id="song-album" aria-label="Filter by album"><option value="">All albums</option></select>
        <select id="song-genre" aria-label="Filter by genre"><option value="">All genres</option></select>
        <select id="song-year" aria-label="Filter by year"><option value="">All years</option></select>
        <select id="song-sort" aria-label="Sort songs">
          <option value="phone">Phone order</option><option value="newest">Newest added</option>
          <option value="oldest">Oldest added</option>
          <option value="title">Title A–Z</option><option value="title-desc">Title Z–A</option>
          <option value="artist">Artist A–Z</option><option value="year-desc">Year newest</option>
          <option value="year">Year oldest</option><option value="rating-desc">Rating highest</option>
          <option value="rating">Rating lowest</option><option value="played">Most played</option>
        </select>
      </div>
      <p id="musico-status" class="form-status" role="status" aria-live="polite">Loading songs…</p>
      <ul id="musico-tracks" class="musico-list"></ul>
    </main>
  `
  const list = page.querySelector('#musico-tracks')
  const message = page.querySelector('#musico-status')
  const input = page.querySelector('#audio-upload')
  const usage = page.querySelector('#musico-usage')
  const controls = page.querySelector('.musico-library-tools')
  const initialFilters = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  let tracks = []
  let phoneOrder = new Map()
  let initialFiltersApplied = false

  function options(id, values, defaultLabel) {
    const select = controls.querySelector(`#${id}`)
    const chosen = select.value
    select.replaceChildren(new Option(defaultLabel, ''))
    for (const value of values) select.add(new Option(String(value), String(value)))
    select.value = chosen
  }

  function visibleTracks() {
    const query = controls.querySelector('#song-query').value.trim().toLocaleLowerCase()
    const artist = controls.querySelector('#song-artist').value
    const album = controls.querySelector('#song-album').value
    const genre = controls.querySelector('#song-genre').value
    const year = controls.querySelector('#song-year').value
    const filtered = tracks.filter((track) =>
      (!query || `${track.title} ${track.artist}`.toLocaleLowerCase().includes(query))
      && (!artist || track.artist === artist) && (!album || track.album === album)
      && (!genre || track.genre.split(/[/;,]/).map((part) => part.trim()).includes(genre))
      && (!year || String(track.year) === year))
    const sort = controls.querySelector('#song-sort').value
    const compare = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    return filtered.sort((a, b) => {
      if (sort === 'phone') return (phoneOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER)
        - (phoneOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id - b.id
      if (sort === 'title') return compare(a.title, b.title)
      if (sort === 'title-desc') return compare(b.title, a.title)
      if (sort === 'artist') return compare(a.artist, b.artist) || compare(a.title, b.title)
      if (sort === 'year') return (a.year ?? 0) - (b.year ?? 0)
      if (sort === 'year-desc') return (b.year ?? 0) - (a.year ?? 0)
      if (sort === 'rating') return (a.rating ?? 11) - (b.rating ?? 11)
      if (sort === 'rating-desc') return (b.rating ?? -1) - (a.rating ?? -1)
      if (sort === 'played') return b.play_count - a.play_count
      if (sort === 'oldest') return a.id - b.id
      return b.id - a.id
    })
  }

  function renderList() {
    const visible = visibleTracks()
    list.replaceChildren()
    visible.forEach((track, index) => {
      list.append(renderTrackRow(track, () => playback.select(visible, index), async () => {
        if (!window.confirm(`Delete “${track.title}”? It will also leave every playlist.`)) return
        try {
          await loadJson(requestJson, 'DELETE', `/api/musico/tracks/${track.id}`,
            undefined, responseError, versionHeader(track.version))
          playback.remove(track.id)
          await refresh()
          status(message, 'Song deleted.')
        } catch (error) { status(message, error.message, true) }
      }, 'Delete', () => { window.location.hash = songDetailsUrl(track.id) }))
    })
    status(message, tracks.length ? (visible.length ? '' : 'No songs match these filters.') : 'No songs yet. Upload an audio file to get started.')
  }

  controls.addEventListener('input', renderList)
  controls.addEventListener('change', renderList)
  async function refresh() {
    try {
      await ready(requestJson, responseError)
      const payload = await loadJson(requestJson, 'GET', '/api/musico/tracks', undefined, responseError)
      if (!app.contains(list)) return
      tracks = payload.tracks ?? []
      phoneOrder = new Map((payload.phone_order ?? []).map((id, index) => [id, index]))
      usage.querySelector('[data-storage-usage]').textContent = `${formatAudioBytes(payload.usage.bytes)} / ${formatAudioBytes(payload.limits.bytes)}`
      const storageBar = usage.querySelector('[data-storage-bar]')
      storageBar.max = payload.limits.bytes
      storageBar.value = payload.usage.bytes
      page.querySelector('#musico-file-limit').textContent = ` · ${formatAudioBytes(payload.limits.per_file_bytes)} per file`
      usage.hidden = false
      options('song-artist', [...new Set(tracks.map((track) => track.artist).filter(Boolean))].sort(), 'All artists')
      options('song-album', [...new Set(tracks.map((track) => track.album).filter(Boolean))].sort(), 'All albums')
      options('song-genre', [...new Set(tracks.flatMap((track) => track.genre.split(/[/;,]/).map((part) => part.trim())).filter(Boolean))].sort(), 'All genres')
      options('song-year', [...new Set(tracks.map((track) => track.year).filter(Boolean))].sort((a, b) => b - a), 'All years')
      if (!initialFiltersApplied) {
        for (const field of ['artist', 'album', 'genre', 'year']) {
          const select = controls.querySelector(`#song-${field}`)
          const requested = initialFilters.get(field)
          if (requested && [...select.options].some((option) => option.value === requested)) select.value = requested
        }
        initialFiltersApplied = true
      }
      renderList()
    } catch (error) {
      usage.hidden = true
      if (app.contains(message)) status(message, error.message, true)
    }
  }

  input.addEventListener('change', async () => {
    const files = [...input.files]
    input.value = ''
    if (!files.length) return
    input.disabled = true
    let uploaded = 0
    for (const [index, file] of files.entries()) {
      if (file.size > MAX_TRACK_BYTES) {
        status(message, `${file.name} exceeds 24 MiB. ${uploaded} file(s) uploaded.`, true)
        break
      }
      status(message, `Uploading ${index + 1} of ${files.length}…`)
      try {
        const form = new FormData()
        form.append('file', file)
        try {
          const { parseBlob } = await import('music-metadata')
          const metadata = (await parseBlob(file, { skipCovers: true })).common
          const text = (value) => typeof value === 'string' && new TextEncoder().encode(value.trim()).length <= 200
            ? value.trim() : ''
          if (text(metadata.title)) form.append('title', text(metadata.title))
          if (text(metadata.artist)) form.append('artist', text(metadata.artist))
          if (text(metadata.album)) form.append('album', text(metadata.album))
          const genre = text(metadata.genre?.join(', '))
          if (genre) form.append('genre', genre)
          if (Number.isInteger(metadata.year) && metadata.year >= 1800 && metadata.year <= 2100) {
            form.append('year', String(metadata.year))
          }
          if (Number.isInteger(metadata.track?.no) && metadata.track.no >= 1 && metadata.track.no <= 999) {
            form.append('track_number', String(metadata.track.no))
          }
        } catch { /* Some audio files have no readable tags; use their filename. */ }
        const uploadKey = crypto.randomUUID()
        let response
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            response = await fetch('/api/musico/tracks', {
              method: 'POST', headers: { 'Idempotency-Key': uploadKey }, body: form,
            })
          } catch (error) {
            if (attempt === 0) continue
            throw error
          }
          if (response.status < 500 || attempt === 1) break
        }
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(typeof payload?.error === 'string'
          ? payload.error : responseError(response, payload))
        uploaded += 1
      } catch (error) {
        const reason = error.message.replace(/[.!?]+$/, '')
        status(message, `${file.name}: ${reason}. ${uploaded ? `${uploaded} file(s) uploaded.` : 'No files uploaded.'}`, true)
        break
      }
    }
    input.disabled = false
    if (uploaded) {
      await refresh()
      status(message, `${uploaded} song${uploaded === 1 ? '' : 's'} uploaded.`)
    }
  })
  refresh()
}

