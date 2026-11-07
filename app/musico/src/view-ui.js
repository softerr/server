import { createPlayer, playIcon } from './player.js'
import { deleteIcon, removeIcon, missingMediaIcon } from '../../shared/icons.js'
import { showMissingImageWhenUnavailable } from '../../shared/missing-image.js'
import { formatBytes } from '../../shared/format.js'
import { mediaThumbnailUrl } from '../../shared/media-client.js'
import { loadJson } from './api.js'

let player

export function musicPlayer(requestJson) {
  player ??= createPlayer(requestJson)
  return player
}

const detailsIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>'

export function songDetailsUrl(id) {
  const from = window.location.hash.slice(1)
  return `#details?${new URLSearchParams({ id, from })}`
}

export function status(element, message, error = false) {
  element.textContent = message
  element.classList.toggle('error', error)
}

export const formatAudioBytes = (bytes) => formatBytes(bytes, { minimumUnit: 'MiB' })

export function button(label, className, action) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  element.addEventListener('click', action)
  return element
}

export function iconButton(label, icon, action) {
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
  showMissingImageWhenUnavailable(image, { className: 'musico-missing-art', icon: missingMediaIcon })
  return image
}

export function renderTrackRow(track, onPlay, onDelete, removeLabel = 'Delete', onDetails = null) {
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
  detail.textContent = [track.artist, track.album, track.genre, track.year, track.rating === null ? '' : `★ ${track.rating}/10`].filter(Boolean).join(' · ')
  info.append(name, detail)
  main.append(info)
  const actions = document.createElement('div')
  actions.className = 'musico-row-actions'
  actions.append(iconButton('Play song', playIcon, onPlay))
  if (onDetails) actions.append(iconButton('Song details', detailsIcon, onDetails))
  if (onDelete) actions.append(iconButton(removeLabel === 'Remove' ? 'Remove song from playlist' : 'Delete song',
    removeLabel === 'Remove' ? removeIcon : deleteIcon, onDelete))
  row.append(main, actions)
  return row
}

export async function ready(requestJson, responseError) {
  await loadJson(requestJson, 'PUT', '/api/musico/me', undefined, responseError)
}

export function stopMusicPlayer() { player?.stop() }
export function updateMusicTrack(track) { player?.updateTrack(track) }
