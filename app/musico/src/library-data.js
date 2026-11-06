import { versionHeader, loadJson } from './api.js'

function key(track) {
  return `${track.original_name}\u0000${track.size_bytes}`
}

const json = (requestJson, responseError, method, path, body, headers = {}) =>
  loadJson(requestJson, method, path, body, responseError, headers)

export async function exportLibrary(requestJson, responseError) {
  const [library, index] = await Promise.all([
    json(requestJson, responseError, 'GET', '/api/musico/tracks'),
    json(requestJson, responseError, 'GET', '/api/musico/playlists'),
  ])
  const playlists = await Promise.all(index.playlists.map(async (playlist) => {
    const detail = await json(requestJson, responseError, 'GET', `/api/musico/playlists/${playlist.id}`)
    return { name: playlist.name, tracks: detail.tracks.map(key) }
  }))
  const snapshot = {
    version: 1,
    exported_at: new Date().toISOString(),
    note: 'Audio files are not included. Upload the same files before importing this metadata.',
    tracks: library.tracks.map((track) => ({
      original_name: track.original_name, size_bytes: track.size_bytes,
      title: track.title, artist: track.artist, album: track.album, genre: track.genre,
      year: track.year, track_number: track.track_number, rating: track.rating,
      play_count: track.play_count, listen_ms: track.listen_ms,
      analysis: track.analysis ?? null,
    })),
    playlists,
  }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `musico-library-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function importLibrary(file, requestJson, responseError, onProgress) {
  if (file.size > 2097152) throw new Error('Library JSON must be at most 2 MiB.')
  let snapshot
  try { snapshot = JSON.parse(await file.text()) } catch { throw new Error('Invalid JSON file.') }
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.tracks) || !Array.isArray(snapshot.playlists)
    || snapshot.tracks.length > 10000 || snapshot.playlists.length > 1000) {
    throw new Error('Unsupported Musico library file.')
  }
  const validText = (value, required = false, max = 200) => typeof value === 'string'
    && new TextEncoder().encode(value).length <= max && (!required || value.trim().length > 0)
  const validOptionalNumber = (value, min, max) => value === null
    || (Number.isInteger(value) && value >= min && value <= max)
  const validOptionalDecimal = (value, min, max) => value === null
    || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
  const validAnalysis = (value) => value === null || (value && typeof value === 'object'
    && !Array.isArray(value) && Object.keys(value).length === 11
    && validOptionalNumber(value.duration_ms, 0, 86400000)
    && validOptionalNumber(value.bit_rate, 1, 1000000000)
    && validOptionalNumber(value.sample_rate_hz, 1, 1000000)
    && validOptionalNumber(value.bit_depth, 1, 64)
    && validOptionalNumber(value.channels, 1, 64)
    && (value.codec === null || validText(value.codec, true, 100))
    && validOptionalNumber(value.estimated_bpm, 30, 300)
    && (value.estimated_key === null || validText(value.estimated_key, true, 32))
    && validOptionalDecimal(value.peak_db, -200, 20)
    && validOptionalDecimal(value.average_db, -200, 20)
    && validOptionalDecimal(value.dynamic_range_db, 0, 220))
  if (!snapshot.tracks.every((track) => track && validText(track.original_name, true, 255)
    && Number.isInteger(track.size_bytes) && track.size_bytes > 0
    && validText(track.title, true) && validText(track.artist)
    && validText(track.album) && validText(track.genre)
    && validOptionalNumber(track.year, 1800, 2100)
    && validOptionalNumber(track.track_number, 1, 999)
    && validOptionalNumber(track.rating, 0, 10)
    && Number.isSafeInteger(track.play_count) && track.play_count >= 0 && track.play_count <= 1000000000
    && Number.isSafeInteger(track.listen_ms) && track.listen_ms >= 0 && track.listen_ms <= 1000000000000000
    && (track.analysis === undefined || validAnalysis(track.analysis)))
    || !snapshot.playlists.every((playlist) => playlist && validText(playlist.name, true, 100)
      && Array.isArray(playlist.tracks) && playlist.tracks.length <= 10000
      && playlist.tracks.every((songKey) => typeof songKey === 'string' && songKey.length <= 300))) {
    throw new Error('Library JSON contains invalid songs or playlists.')
  }
  const [library, index] = await Promise.all([
    json(requestJson, responseError, 'GET', '/api/musico/tracks'),
    json(requestJson, responseError, 'GET', '/api/musico/playlists'),
  ])
  const byKey = new Map()
  for (const track of library.tracks) {
    const id = key(track)
    byKey.set(id, byKey.has(id) ? null : track)
  }
  let updated = 0
  let added = 0
  let created = 0
  for (const source of snapshot.tracks) {
    if (!source || typeof source.original_name !== 'string' || !Number.isInteger(source.size_bytes)) continue
    const target = byKey.get(key(source))
    if (!target) continue
    onProgress(`Updating song ${updated + 1}…`)
    const body = {
      title: source.title, artist: source.artist, album: source.album, genre: source.genre,
      year: source.year, track_number: source.track_number, rating: source.rating,
      art_image_id: target.art_image_id ?? null,
    }
    const updatedTrack = await json(requestJson, responseError, 'PATCH',
      `/api/musico/tracks/${target.id}`, body, versionHeader(target.version))
    target.version = updatedTrack.version
    const restored = await json(requestJson, responseError, 'POST', `/api/musico/tracks/${target.id}/restore-stats`, {
      play_count: source.play_count, listen_ms: source.listen_ms,
    }, { ...versionHeader(target.stats_version, 's'), 'Idempotency-Key': crypto.randomUUID() })
    target.stats_version = restored.stats_version
    if (source.analysis) {
      const saved = await json(requestJson, responseError, 'PUT',
        `/api/musico/tracks/${target.id}/analysis`, source.analysis, versionHeader(target.version))
      target.version = saved.version
    }
    updated += 1
  }
  const playlistsByName = new Map(index.playlists.map((playlist) => [playlist.name, playlist]))
  for (const source of snapshot.playlists) {
    if (!source || typeof source.name !== 'string' || !Array.isArray(source.tracks)) continue
    let target = playlistsByName.get(source.name)
    if (!target) {
      onProgress(`Creating playlist “${source.name}”…`)
      target = await json(requestJson, responseError, 'POST', '/api/musico/playlists', { name: source.name })
      playlistsByName.set(source.name, target)
      created += 1
    }
    const existing = await json(requestJson, responseError, 'GET', `/api/musico/playlists/${target.id}`)
    const used = new Set(existing.tracks.map((track) => track.id))
    for (const songKey of source.tracks) {
      const track = byKey.get(songKey)
      if (!track || used.has(track.id)) continue
      const addedTrack = await json(requestJson, responseError, 'POST',
        `/api/musico/playlists/${target.id}/tracks`, { track_id: track.id },
        versionHeader(existing.playlist.version))
      existing.playlist.version = addedTrack.version
      used.add(track.id)
      added += 1
    }
  }
  return { updated, created, added }
}
