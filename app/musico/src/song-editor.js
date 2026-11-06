import { mountArtworkPicker } from './artwork.js'
import { MAX_IMAGE_BYTES } from '../../shared/media-limits.js'
import { mediaThumbnailUrl, uploadMediaImage } from '../../shared/media-client.js'
import { versionHeader } from './api.js'

export function mountSongEditor(container, { requestJson, responseError, onSaved }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'musico-dialog musico-edit-song-dialog'
  dialog.innerHTML = `
    <form>
      <h2>Edit song</h2>
      <button data-art type="button" class="musico-edit-art">Choose album art</button>
      <label class="field"><span>Title</span><input name="title" maxlength="200" required></label>
      <label class="field"><span>Artist</span><input name="artist" maxlength="200"></label>
      <label class="field"><span>Album</span><input name="album" maxlength="200"></label>
      <label class="field"><span>Genre</span><input name="genre" maxlength="200"></label>
      <div class="musico-edit-numbers">
        <label class="field"><span>Year</span><input name="year" type="number" min="1800" max="2100"></label>
        <label class="field"><span>Track</span><input name="track_number" type="number" min="1" max="999"></label>
        <label class="field"><span>Rating</span><input name="rating" type="number" min="0" max="10"></label>
      </div>
      <div class="musico-dialog-actions musico-metadata-actions"><button data-clean type="button" class="auth-button auth-button-secondary">Clean title</button><button data-lookup type="button" class="auth-button auth-button-secondary">Look up metadata</button><button data-undo type="button" class="auth-button auth-button-secondary" hidden>Undo lookup</button></div>
      <p data-status class="form-status" role="status"></p>
      <div class="musico-dialog-actions"><button data-cancel type="button" class="auth-button auth-button-secondary">Cancel</button><button type="submit" class="auth-button auth-button-primary">Save</button></div>
    </form>
  `
  container.append(dialog)
  const form = dialog.querySelector('form')
  const artButton = dialog.querySelector('[data-art]')
  const message = dialog.querySelector('[data-status]')
  const undo = dialog.querySelector('[data-undo]')
  const artwork = mountArtworkPicker(container, { requestJson, responseError })
  let current = null
  let artImageId = null
  let pendingArtwork = null
  let lookupSnapshot = null

  function status(text, error = false) {
    message.textContent = text
    message.classList.toggle('error', error)
  }

  function clearPendingArtwork() {
    if (pendingArtwork) URL.revokeObjectURL(pendingArtwork.preview)
    pendingArtwork = null
  }

  function renderArt() {
    artButton.replaceChildren()
    if (!pendingArtwork && !artImageId) {
      artButton.textContent = 'Choose album art'
      return
    }
    const image = document.createElement('img')
    image.src = pendingArtwork?.preview ?? mediaThumbnailUrl(artImageId)
    image.alt = 'Selected album art'
    const label = document.createElement('span')
    label.textContent = 'Change album art'
    artButton.append(image, label)
  }

  artButton.addEventListener('click', async () => {
    const selected = await artwork.open()
    if (!dialog.open || selected === undefined) return
    clearPendingArtwork()
    artImageId = selected
    renderArt()
  })
  dialog.addEventListener('close', clearPendingArtwork)
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close())
  dialog.querySelector('[data-clean]').addEventListener('click', () => {
    const title = form.elements.title
    const parts = title.value.split(/\s+[-–—~]\s+/, 3)
    if (parts.length >= 2) {
      if (/^\d+$/.test(parts[0]) && parts.length === 3) {
        form.elements.track_number.value = parts[0]
        form.elements.artist.value = parts[1].trim()
        title.value = parts[2].trim()
      } else {
        form.elements.artist.value = parts[0].trim()
        title.value = parts.slice(1).join(' - ').trim()
      }
    }
    title.value = title.value.replace(/\.(mp3|ogg|wav|flac|m4a)$/i, '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim()
  })
  undo.addEventListener('click', () => {
    if (!lookupSnapshot) return
    for (const [field, value] of Object.entries(lookupSnapshot)) {
      if (field === 'art_image_id') artImageId = value
      else form.elements[field].value = value
    }
    clearPendingArtwork()
    renderArt()
    lookupSnapshot = null
    undo.hidden = true
    status('')
  })
  dialog.querySelector('[data-lookup]').addEventListener('click', async (event) => {
    const lookup = event.currentTarget
    const lookupTrackId = current?.id
    const query = `${form.elements.title.value} ${form.elements.artist.value}`.trim()
    if (!query) return
    lookup.disabled = true
    status('Looking up metadata…')
    try {
      const url = new URL('https://itunes.apple.com/search')
      url.search = new URLSearchParams({ term: query, media: 'music', entity: 'song', limit: '10' })
      const response = await fetch(url)
      if (!response.ok) throw new Error('Metadata lookup is unavailable.')
      const matches = (await response.json()).results ?? []
      const match = matches.find((item) => item.kind === 'song' && item.trackName && item.artistName)
      if (!match) throw new Error('No matching song found.')
      if (!dialog.open || current?.id !== lookupTrackId) return
      if (!lookupSnapshot) {
        lookupSnapshot = Object.fromEntries(
          ['title', 'artist', 'album', 'genre', 'year', 'track_number'].map((field) => [field, form.elements[field].value]))
        lookupSnapshot.art_image_id = artImageId
      }
      form.elements.title.value = match.trackName
      form.elements.artist.value = match.artistName
      form.elements.album.value = match.collectionName ?? ''
      form.elements.genre.value = match.primaryGenreName ?? ''
      form.elements.year.value = /^\d{4}/.test(match.releaseDate ?? '') ? match.releaseDate.slice(0, 4) : ''
      form.elements.track_number.value = match.trackNumber || ''
      undo.hidden = false
      clearPendingArtwork()
      let artworkError = ''
      if (match.artworkUrl100) {
        try {
          const coverUrl = new URL(match.artworkUrl100.replace('100x100', '600x600'))
          if (coverUrl.protocol !== 'https:' || !/^is\d+-ssl\.mzstatic\.com$/i.test(coverUrl.hostname)) {
            throw new Error('Unsupported iTunes artwork URL.')
          }
          const coverResponse = await fetch(coverUrl, { credentials: 'omit' })
          if (!coverResponse.ok) throw new Error('iTunes artwork is unavailable.')
          const cover = await coverResponse.blob()
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(cover.type)
            || cover.size < 1 || cover.size > MAX_IMAGE_BYTES) {
            throw new Error('iTunes artwork exceeds the image limits.')
          }
          if (!dialog.open || current?.id !== lookupTrackId) return
          pendingArtwork = {
            blob: cover,
            name: `Album art - ${match.collectionId || match.trackId || current.id}.${{
              'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
            }[cover.type]}`,
            preview: URL.createObjectURL(cover),
          }
          renderArt()
        } catch (error) { artworkError = error.message }
      }
      status(artworkError
        ? `Metadata found, but artwork could not be loaded: ${artworkError}`
        : pendingArtwork ? 'Metadata and artwork found. Review them before saving.'
          : 'Metadata found. No artwork was available.', Boolean(artworkError))
    } catch (error) { if (dialog.open && current?.id === lookupTrackId) status(error.message, true) }
    finally { lookup.disabled = false }
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!current) return
    const save = form.querySelector('[type="submit"]')
    save.disabled = true
    try {
      if (pendingArtwork) {
        const [response, payload] = await uploadMediaImage(pendingArtwork.blob, pendingArtwork.name)
        if (!response.ok) throw new Error(responseError(response, payload))
        artImageId = payload.id
        clearPendingArtwork()
        renderArt()
      }
      const number = (field) => form.elements[field].value === '' ? null : Number(form.elements[field].value)
      const [response, updated] = await requestJson('PATCH', `/api/musico/tracks/${current.id}`, {
        title: form.elements.title.value, artist: form.elements.artist.value,
        album: form.elements.album.value, genre: form.elements.genre.value,
        year: number('year'), track_number: number('track_number'), rating: number('rating'),
        art_image_id: artImageId,
      }, versionHeader(current.version))
      if (!response.ok) throw new Error(responseError(response, updated))
      current = updated
      dialog.close()
      onSaved(updated)
    } catch (error) { if (dialog.open) status(error.message, true) }
    finally { save.disabled = false }
  })

  return {
    open(track) {
      current = track
      clearPendingArtwork()
      artImageId = track.art_image_id
      renderArt()
      lookupSnapshot = null
      undo.hidden = true
      for (const field of ['title', 'artist', 'album', 'genre', 'year', 'track_number', 'rating']) {
        form.elements[field].value = track[field] ?? ''
      }
      status('')
      dialog.showModal()
      form.elements.title.focus()
    },
  }
}
