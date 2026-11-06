import './style.css'
import { startAuthApp } from '../../shared/auth-app.js'
import { editIcon, deleteIcon, removeIcon } from '../../shared/icons.js'
import { createPlayer } from './player.js'
import { renderDiscover } from './discover.js'
import { exportLibrary, importLibrary } from './library-data.js'
import { renderSongDetails } from './details.js'
import { versionHeader, loadJson } from './api.js'
import { formatBytes } from '../../shared/format.js'
import { mediaThumbnailUrl } from '../../shared/media-client.js'

const MAX_TRACK_BYTES = 24 * 1024 * 1024
let player

function musicPlayer(requestJson) {
  player ??= createPlayer(requestJson)
  return player
}

const detailsIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>'

function songDetailsUrl(id) {
  const from = window.location.hash.slice(1)
  return `#details?${new URLSearchParams({ id, from })}`
}

function status(element, message, error = false) {
  element.textContent = message
  element.classList.toggle('error', error)
}

const formatAudioBytes = (bytes) => formatBytes(bytes, { minimumUnit: 'MiB' })

function button(label, className, action) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  element.addEventListener('click', action)
  return element
}

function iconButton(label, icon, action) {
  const element = button(label, 'musico-icon-action', action)
  element.innerHTML = icon
  element.setAttribute('aria-label', label)
  element.title = label
  return element
}

function artThumbnail(id, alt = '') {
  const image = document.createElement('img')
  image.src = mediaThumbnailUrl(id)
  image.alt = alt
  image.loading = 'lazy'
  image.addEventListener('error', () => {
    const missing = document.createElement('span')
    missing.className = 'musico-missing-art'
    missing.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m4 18 5-5 3 3 3-3 5 5M4 4l16 16"/></svg>'
    missing.setAttribute('aria-label', 'Missing image')
    image.replaceWith(missing)
  }, { once: true })
  return image
}

function renderTrackRow(track, onPlay, onDelete, removeLabel = 'Delete', onDetails = null) {
  const row = document.createElement('li')
  row.className = 'musico-row'
  const main = document.createElement('div')
  main.className = 'musico-row-main'
  const info = document.createElement('div')
  info.className = 'musico-row-info'
  const name = document.createElement('strong')
  name.textContent = track.title
  if (track.art_image_id) {
    const art = artThumbnail(track.art_image_id)
    art.className = 'musico-row-art'
    main.append(art)
  }
  const detail = document.createElement('span')
  detail.textContent = [track.artist, track.album, track.genre, track.year, track.rating === null ? '' : `★ ${track.rating}/10`, formatAudioBytes(track.size_bytes)].filter(Boolean).join(' · ')
  info.append(name, detail)
  main.append(info)
  const actions = document.createElement('div')
  actions.className = 'musico-row-actions'
  actions.append(button('Play', 'auth-button auth-button-secondary', onPlay))
  if (onDetails) actions.append(iconButton('Song details', detailsIcon, onDetails))
  if (onDelete) actions.append(iconButton(removeLabel === 'Remove' ? 'Remove song from playlist' : 'Delete song',
    removeLabel === 'Remove' ? removeIcon : deleteIcon, onDelete))
  row.append(main, actions)
  return row
}

async function ready(requestJson, responseError) {
  await loadJson(requestJson, 'PUT', '/api/musico/me', undefined, responseError)
}

function renderSongs(app, { requestJson, responseError }) {
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
          <option value="newest">Newest added</option><option value="oldest">Oldest added</option>
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

function renderPlaylists(app, { requestJson, responseError }) {
  const page = app.querySelector('#page')
  const playback = musicPlayer(requestJson)
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const selectedId = Number(params.get('id'))
  const tab = ['playlists', 'artists', 'albums', 'genres'].includes(params.get('tab')) ? params.get('tab') : 'playlists'
  page.innerHTML = `
    <main class="musico-page">
      <div class="musico-heading">
        <h1 class="section-title">Playlists</h1>
      </div>
      <p id="musico-status" class="form-status" role="status" aria-live="polite">Loading playlists…</p>
      <div id="playlist-content"></div>
      <dialog id="playlist-dialog" class="musico-dialog">
        <form id="playlist-form" method="dialog">
          <h2 id="playlist-dialog-title">Create playlist</h2>
          <label class="field"><span>Name</span><input name="name" maxlength="100" required></label>
          <p id="playlist-dialog-status" class="form-status" role="status"></p>
          <div class="musico-dialog-actions"><button class="auth-button auth-button-secondary" value="cancel">Cancel</button><button class="auth-button auth-button-primary" id="save-playlist" value="save">Save</button></div>
        </form>
      </dialog>
    </main>
  `
  const content = page.querySelector('#playlist-content')
  const message = page.querySelector('#musico-status')
  const dialog = page.querySelector('#playlist-dialog')
  const form = page.querySelector('#playlist-form')
  let editId = null
  let editVersion = null

  function openDialog(id, name, version = null) {
    editId = id
    editVersion = version
    form.elements.name.value = name
    page.querySelector('#playlist-dialog-title').textContent = id ? 'Rename playlist' : 'Create playlist'
    status(page.querySelector('#playlist-dialog-status'), '')
    dialog.showModal()
    form.elements.name.focus()
  }
  form.addEventListener('submit', async (event) => {
    if (event.submitter?.value === 'cancel') return
    event.preventDefault()
    const name = form.elements.name.value.trim()
    if (!name) return
    const save = page.querySelector('#save-playlist')
    save.disabled = true
    try {
      const path = editId ? `/api/musico/playlists/${editId}` : '/api/musico/playlists'
      await loadJson(requestJson, editId ? 'PATCH' : 'POST', path, { name }, responseError,
        editId ? versionHeader(editVersion) : {})
      dialog.close()
      await refresh()
      status(message, editId ? 'Playlist renamed.' : 'Playlist created.')
    } catch (error) {
      status(page.querySelector('#playlist-dialog-status'), error.message, true)
    } finally { save.disabled = false }
  })

  async function refresh() {
    try {
      await ready(requestJson, responseError)
      if (selectedId > 0 && Number.isSafeInteger(selectedId)) await renderDetail(selectedId)
      else await renderIndex()
    } catch (error) {
      if (app.contains(message)) status(message, error.message, true)
    }
  }

  async function renderIndex() {
    const [payload, library] = await Promise.all([
      loadJson(requestJson, 'GET', '/api/musico/playlists', undefined, responseError),
      loadJson(requestJson, 'GET', '/api/musico/tracks', undefined, responseError),
    ])
    if (!app.contains(content)) return
    content.replaceChildren()
    const tabs = document.createElement('nav')
    tabs.className = 'musico-browse-tabs'
    tabs.setAttribute('aria-label', 'Browse music')
    for (const name of ['playlists', 'artists', 'albums', 'genres']) {
      const link = document.createElement('a')
      link.href = name === 'playlists' ? '#playlists' : `#playlists?tab=${name}`
      link.textContent = name[0].toUpperCase() + name.slice(1)
      if (tab === name) link.setAttribute('aria-current', 'page')
      tabs.append(link)
    }
    content.append(tabs)
    const grid = document.createElement('div')
    grid.className = 'musico-grid'
    if (tab === 'playlists') {
      const createCard = document.createElement('button')
      createCard.type = 'button'
      createCard.className = 'musico-card musico-card-create'
      createCard.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg><strong>Create playlist</strong>'
      createCard.addEventListener('click', () => openDialog(null, ''))
      grid.append(createCard)
      for (const playlist of payload.playlists ?? []) {
        const card = document.createElement('a')
        card.className = 'musico-card'
        card.href = `#playlists?id=${playlist.id}`
        const title = document.createElement('strong')
        title.textContent = playlist.name
        const count = document.createElement('span')
        count.textContent = `${playlist.track_count} song${playlist.track_count === 1 ? '' : 's'}`
        card.append(title, count)
        grid.append(card)
      }
    } else {
      const groups = new Map()
      for (const track of library.tracks ?? []) {
        const values = tab === 'genres' ? track.genre.split(/[/;,]/).map((value) => value.trim()).filter(Boolean)
          : [tab === 'artists' ? track.artist : track.album].filter(Boolean)
        for (const name of values) groups.set(name, (groups.get(name) ?? 0) + 1)
      }
      for (const [name, count] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const card = document.createElement('a')
        card.className = 'musico-card'
        card.href = `#songs?${new URLSearchParams({ [tab.slice(0, -1)]: name })}`
        const title = document.createElement('strong')
        title.textContent = name
        const total = document.createElement('span')
        total.textContent = `${count} song${count === 1 ? '' : 's'}`
        card.append(title, total)
        grid.append(card)
      }
    }
    content.append(grid)
    status(message, '')
  }

  async function renderDetail(id) {
    const [payload, library] = await Promise.all([
      loadJson(requestJson, 'GET', `/api/musico/playlists/${id}`, undefined, responseError),
      loadJson(requestJson, 'GET', '/api/musico/tracks', undefined, responseError),
    ])
    if (!app.contains(content)) return
    content.innerHTML = `
      <div class="musico-detail-heading"><a href="#playlists" class="musico-back">← Playlists</a><h2 id="playlist-name"></h2><div id="playlist-actions"></div></div>
      <div class="musico-add-row"><button id="open-add-songs" class="auth-button auth-button-secondary" type="button">Add songs</button></div>
      <div class="musico-library-tools"><input id="playlist-search" type="search" placeholder="Search songs" aria-label="Search playlist songs"><select id="playlist-sort" aria-label="Sort playlist songs"><option value="order">Playlist order</option><option value="title">Title A–Z</option><option value="artist">Artist A–Z</option><option value="rating">Rating highest</option></select></div>
      <ul id="playlist-tracks" class="musico-list"></ul>
      <dialog id="add-songs-dialog" class="musico-dialog musico-song-dialog" aria-labelledby="add-songs-title">
        <form id="add-songs-form" method="dialog">
          <h2 id="add-songs-title">Add songs</h2>
          <label class="field"><span>Search songs</span><input id="song-search" type="search" autocomplete="off"></label>
          <p id="song-selection-count" class="musico-selection-count"></p>
          <div id="song-picker-list" class="musico-pick-list" role="group" aria-label="Songs"></div>
          <p id="add-songs-status" class="form-status" role="status" aria-live="polite"></p>
          <div class="musico-dialog-actions"><button id="cancel-add-songs" class="auth-button auth-button-secondary" type="button">Cancel</button><button id="save-add-songs" class="auth-button auth-button-primary" type="submit" disabled>Add selected</button></div>
        </form>
      </dialog>
    `
    content.querySelector('#playlist-name').textContent = payload.playlist.name
    const actions = content.querySelector('#playlist-actions')
    actions.append(
      iconButton('Rename playlist', editIcon, () => openDialog(id, payload.playlist.name, payload.playlist.version)),
      iconButton('Delete playlist', deleteIcon, async () => {
        if (!window.confirm(`Delete playlist “${payload.playlist.name}”? Songs will stay in your library.`)) return
        try {
          await loadJson(requestJson, 'DELETE', `/api/musico/playlists/${id}`,
            undefined, responseError, versionHeader(payload.playlist.version))
          window.location.hash = '#playlists'
        } catch (error) { status(message, error.message, true) }
      }),
    )
    const used = new Set(payload.tracks.map((track) => track.id))
    const addDialog = content.querySelector('#add-songs-dialog')
    const addList = content.querySelector('#song-picker-list')
    const search = content.querySelector('#song-search')
    const selectionCount = content.querySelector('#song-selection-count')
    const saveSongs = content.querySelector('#save-add-songs')
    const cancelSongs = content.querySelector('#cancel-add-songs')
    const addStatus = content.querySelector('#add-songs-status')
    const rows = []
    for (const track of library.tracks ?? []) {
      const row = document.createElement('label')
      row.className = 'musico-pick-item'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.name = 'track'
      checkbox.value = track.id
      checkbox.disabled = used.has(track.id)
      const info = document.createElement('span')
      info.className = 'musico-pick-info'
      const title = document.createElement('strong')
      title.textContent = track.title
      const detail = document.createElement('span')
      detail.textContent = checkbox.disabled ? 'Already in playlist' : (track.artist || track.original_name)
      info.append(title, detail)
      row.append(checkbox, info)
      addList.append(row)
      rows.push({ row, track })
    }
    function updateSelection() {
      const count = addList.querySelectorAll('input[name="track"]:checked').length
      selectionCount.textContent = `${count} selected`
      saveSongs.disabled = count === 0
      saveSongs.textContent = count ? `Add ${count} song${count === 1 ? '' : 's'}` : 'Add selected'
    }
    addList.addEventListener('change', updateSelection)
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase()
      let visible = 0
      for (const { row, track } of rows) {
        row.hidden = !`${track.title} ${track.artist} ${track.original_name}`.toLocaleLowerCase().includes(query)
        if (!row.hidden) visible += 1
      }
      status(addStatus, visible ? '' : (rows.length ? 'No songs match your search.' : 'No songs in your library yet.'))
    })
    content.querySelector('#open-add-songs').addEventListener('click', () => {
      addList.querySelectorAll('input[name="track"]:checked').forEach((input) => { input.checked = false })
      search.value = ''
      search.dispatchEvent(new Event('input'))
      updateSelection()
      addDialog.showModal()
      search.focus()
    })
    cancelSongs.addEventListener('click', () => addDialog.close())
    addDialog.addEventListener('cancel', (event) => {
      if (cancelSongs.disabled) event.preventDefault()
    })
    content.querySelector('#add-songs-form').addEventListener('submit', async (event) => {
      event.preventDefault()
      if (saveSongs.disabled) return
      const ids = [...addList.querySelectorAll('input[name="track"]:checked')].map((input) => Number(input.value))
      saveSongs.disabled = true
      cancelSongs.disabled = true
      let added = 0
      let failure = ''
      for (const trackId of ids) {
        status(addStatus, `Adding ${added + 1} of ${ids.length}…`)
        try {
          const result = await loadJson(requestJson, 'POST', `/api/musico/playlists/${id}/tracks`,
            { track_id: trackId }, responseError, versionHeader(payload.playlist.version))
          payload.playlist.version = result.version
          added += 1
        } catch (error) {
          failure = error.message
          break
        }
      }
      addDialog.close()
      await refresh()
      if (app.contains(saveSongs)) {
        cancelSongs.disabled = false
        updateSelection()
      }
      if (app.contains(message)) {
        status(message, failure
          ? `${added} of ${ids.length} songs added. ${failure}`
          : `${added} song${added === 1 ? '' : 's'} added to playlist.`, Boolean(failure))
      }
    })
    const list = content.querySelector('#playlist-tracks')
    const searchTracks = content.querySelector('#playlist-search')
    const sortTracks = content.querySelector('#playlist-sort')
    function renderTracks() {
      const query = searchTracks.value.toLocaleLowerCase()
      const visible = payload.tracks.filter((track) => `${track.title} ${track.artist}`.toLocaleLowerCase().includes(query))
      if (sortTracks.value === 'title') visible.sort((a, b) => a.title.localeCompare(b.title))
      if (sortTracks.value === 'artist') visible.sort((a, b) => a.artist.localeCompare(b.artist))
      if (sortTracks.value === 'rating') visible.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
      list.replaceChildren()
      visible.forEach((track, index) => {
        list.append(renderTrackRow(track, () => playback.select(visible, index), async () => {
          try {
            await loadJson(requestJson, 'DELETE', `/api/musico/playlists/${id}/tracks/${track.id}`,
              undefined, responseError, versionHeader(payload.playlist.version))
            await refresh()
            status(message, 'Song removed from playlist.')
          } catch (error) { status(message, error.message, true) }
        }, 'Remove', () => { window.location.hash = songDetailsUrl(track.id) }))
      })
    }
    searchTracks.addEventListener('input', renderTracks)
    sortTracks.addEventListener('change', renderTracks)
    renderTracks()
    status(message, payload.tracks.length ? '' : 'This playlist is empty. Add songs from your library.')
  }

  refresh()
}

function renderStats(app, { requestJson, responseError }) {
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

const accent = localStorage.getItem('musico-accent')
if (/^#[0-9a-f]{6}$/i.test(accent || '')) document.documentElement.style.setProperty('--accent', accent)

startAuthApp({
  name: 'Musico',
  homeHref: '/musico/',
  signupPrompt: 'New to Musico?',
  onLogout() { player?.stop() },
  views: ['songs', 'playlists', 'stats', 'discover', 'details'],
  links: [
    { view: 'songs', label: 'Songs' },
    { view: 'playlists', label: 'Playlists' },
    { view: 'stats', label: 'Stats' },
    { view: 'discover', label: 'Discover' },
  ],
  renderView(view, app, helpers) {
    if (view === 'home' || view === 'songs') {
      renderSongs(app, helpers)
      return true
    }
    if (view === 'playlists') {
      renderPlaylists(app, helpers)
      return true
    }
    if (view === 'stats') {
      renderStats(app, helpers)
      return true
    }
    if (view === 'discover') {
      renderDiscover(app, helpers)
      return true
    }
    if (view === 'details') {
      renderSongDetails(app, { ...helpers, onTrackUpdated: (track) => player?.updateTrack(track) })
      return true
    }
    return false
  },
})
