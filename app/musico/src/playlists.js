import { musicPlayer, status, button, iconButton, renderTrackRow, songDetailsUrl, ready } from './view-ui.js'
import { editIcon, deleteIcon } from '../../shared/icons.js'
import { loadJson, versionHeader } from './api.js'

export function renderPlaylists(app, { requestJson, responseError }) {
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

