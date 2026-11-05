import test from 'node:test'
import assert from 'node:assert/strict'
import { importLibrary } from '../../app/musico/src/library-data.js'

test('Musico import updates matching songs and does not add a playlist song twice', async () => {
  const song = {
    id: 7, original_name: 'song.mp3', size_bytes: 1024,
    version: 1, stats_version: 1,
    title: 'Original', artist: '', album: '', genre: '', year: null, track_number: null, rating: null,
    play_count: 4, listen_ms: 9000,
  }
  const snapshot = {
    version: 1,
    tracks: [{ ...song, title: 'Edited', analysis: {
      duration_ms: 120000, bit_rate: 192000, sample_rate_hz: 44100, bit_depth: 16,
      channels: 2, codec: 'MPEG Layer 3', estimated_bpm: 120, estimated_key: 'C major',
      peak_db: -0.5, average_db: -12.3, dynamic_range_db: 11.8,
    } }],
    playlists: [{ name: 'Favorites', tracks: ['song.mp3\u00001024', 'song.mp3\u00001024'] }],
  }
  const calls = []
  const requestJson = async (method, path, body, headers) => {
    calls.push({ method, path, body, headers })
    if (path === '/api/musico/tracks' && method === 'GET') return [{ ok: true }, { tracks: [song] }]
    if (path === '/api/musico/playlists' && method === 'GET') return [{ ok: true }, { playlists: [{ id: 9, name: 'Favorites' }] }]
    if (path === '/api/musico/playlists/9' && method === 'GET') return [{ ok: true }, { playlist: { version: 1 }, tracks: [] }]
    if (method === 'PATCH') return [{ ok: true }, { version: 2 }]
    if (path.endsWith('/restore-stats')) return [{ ok: true }, { stats_version: 2 }]
    if (method === 'PUT') return [{ ok: true }, { version: 3 }]
    if (method === 'POST') return [{ ok: true }, { version: 2 }]
    return [{ ok: true }, {}]
  }
  const file = { size: 1000, text: async () => JSON.stringify(snapshot) }
  const result = await importLibrary(file, requestJson, () => 'error', () => {})
  assert.deepEqual(result, { updated: 1, created: 0, added: 1 })
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 2)
  assert.equal(calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/analysis')).length, 1)
  assert.equal(calls.find((call) => call.method === 'PATCH').headers['If-Match'], '"v1"')
  assert.equal(calls.find((call) => call.path.endsWith('/restore-stats')).headers['If-Match'], '"s1"')
  assert.match(calls.find((call) => call.path.endsWith('/restore-stats')).headers['Idempotency-Key'],
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(calls.find((call) => call.method === 'PUT').headers['If-Match'], '"v2"')
})

test('Musico import rejects invalid metadata before making requests', async () => {
  const file = {
    size: 200,
    text: async () => JSON.stringify({
      version: 1,
      tracks: [{ original_name: 'song.mp3', size_bytes: 1000, title: '', artist: '', album: '', genre: '', year: null, track_number: null, rating: null, play_count: 0, listen_ms: 0 }],
      playlists: [],
    }),
  }
  await assert.rejects(importLibrary(file, () => { throw new Error('unexpected request') }, () => '', () => {}), /invalid songs/)
})
