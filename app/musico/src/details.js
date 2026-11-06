import { drawAudioAnalysis, drawSpectrogram } from './audio-analysis.js'
import { estimateTempoAndKey } from './music-theory.js'
import { mountSongEditor } from './song-editor.js'
import { editIcon } from '../../shared/icons.js'
import { createPageNotice } from '../../shared/page-notice.js'

const downloadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/></svg>'
const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'

function duration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function safeInteger(value, min, max) {
  const rounded = Math.round(value)
  return Number.isFinite(value) && rounded >= min && rounded <= max ? rounded : null
}

function analysisFields(analysis) {
  if (!analysis) return []
  return [
    ['Duration', analysis.duration_ms === null ? null : duration(analysis.duration_ms)],
    ['Bit rate', analysis.bit_rate === null ? null : `${Math.round(analysis.bit_rate / 1000)} kbps`],
    ['Sample rate', analysis.sample_rate_hz === null ? null : `${(analysis.sample_rate_hz / 1000).toFixed(1)} kHz`],
    ['Bit depth', analysis.bit_depth === null ? null : `${analysis.bit_depth} bit`],
    ['Channels', analysis.channels],
    ['Codec', analysis.codec],
    ['Estimated BPM', analysis.estimated_bpm ?? 'Unclear'],
    ['Estimated key', analysis.estimated_key ?? 'Unclear'],
    ['Peak level', analysis.peak_db === null ? null : `${analysis.peak_db.toFixed(1)} dBFS`],
    ['Average level', analysis.average_db === null ? null : `${analysis.average_db.toFixed(1)} dBFS`],
    ['Dynamic range', analysis.dynamic_range_db === null ? null : `${analysis.dynamic_range_db.toFixed(1)} dB`],
  ]
}

export function renderSongDetails(app, { requestJson, responseError, onTrackUpdated }) {
  const page = app.querySelector('#page')
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const trackId = Number(params.get('id'))
  const from = params.get('from') ?? ''
  const back = /^(songs|playlists)(\?.*)?$/.test(from) ? `#${from}` : '#songs'
  const backLabel = from.startsWith('playlists') ? 'Playlists' : 'Songs'
  const detail = document.createElement('main')
  detail.className = 'musico-page musico-details-page'
  detail.innerHTML = `
    <a data-back class="musico-back" href="#songs">← ${backLabel}</a>
    <h1 class="section-title">Song details</h1>
    <p data-status class="form-status" role="status" aria-live="polite">Loading song…</p>
    <section data-content hidden>
    <div class="musico-details-heading">
      <img data-art alt="" hidden>
      <div class="musico-details-name"><strong data-title></strong><span data-artist></span></div>
      <div class="musico-details-actions">
        <button data-edit type="button" class="musico-icon-action" aria-label="Edit song" title="Edit song">${editIcon}</button>
        <a data-download class="musico-icon-action" aria-label="Download audio" title="Download audio">${downloadIcon}</a>
        <button data-copy type="button" class="musico-icon-action" aria-label="Copy song name" title="Copy song name">${copyIcon}</button>
      </div>
    </div>
    <dl data-fields class="musico-details-fields"></dl>
    <dl data-technical class="musico-details-fields"></dl>
    <canvas data-waveform width="640" height="120" aria-label="Audio waveform" hidden></canvas>
    <canvas data-beat-wave width="640" height="80" aria-label="Audio energy over time" hidden></canvas>
    <canvas data-spectrogram width="1200" height="400" aria-label="Audio frequency spectrogram" hidden></canvas>
    <div data-frequency-controls class="musico-frequency-controls" hidden>
      <label for="musico-max-frequency">Max frequency: <span data-frequency-value></span> Hz</label>
      <input id="musico-max-frequency" data-max-frequency type="range" min="1000" max="22050" value="22050" aria-label="Maximum spectrogram frequency">
    </div>
    <div class="musico-details-tools"><button data-analyze type="button" class="auth-button auth-button-secondary">Analyze audio</button></div>
    </section>
  `
  page.replaceChildren(detail)
  const notice = createPageNotice(detail)
  detail.querySelector('[data-back]').href = back
  let current = null
  let decodedBuffer = null
  const active = () => app.contains(detail)
  const frequency = detail.querySelector('[data-max-frequency]')
  const frequencyValue = detail.querySelector('[data-frequency-value]')
  let frequencyTimer
  frequency.addEventListener('input', () => {
    frequencyValue.textContent = Number(frequency.value).toLocaleString()
    window.clearTimeout(frequencyTimer)
    frequencyTimer = window.setTimeout(() => {
      if (active() && decodedBuffer) drawSpectrogram(decodedBuffer, detail.querySelector('[data-spectrogram]'), Number(frequency.value))
    }, 120)
  })
  const editor = mountSongEditor(detail, {
    requestJson, responseError,
    onSaved(track) {
      showTrack(track)
      onTrackUpdated?.(track)
      detail.querySelector('[data-status]').textContent = 'Song updated.'
    },
  })
  detail.querySelector('[data-edit]').addEventListener('click', () => { if (current) editor.open(current) })

  function setFields(element, fields) {
    element.replaceChildren()
    for (const [label, value] of fields) {
      if (value === null || value === undefined || value === '') continue
      const term = document.createElement('dt')
      term.textContent = label
      const detail = document.createElement('dd')
      detail.textContent = String(value)
      element.append(term, detail)
    }
  }

  detail.querySelector('[data-copy]').addEventListener('click', async () => {
    if (!current) return
    try {
      await navigator.clipboard.writeText(`${current.artist} - ${current.title}`)
      if (active()) notice.show('Song name copied.')
    } catch { if (active()) notice.show('Could not copy song name.', 'error') }
  })

  detail.querySelector('[data-analyze]').addEventListener('click', async (event) => {
    if (!current) return
    const trackId = current.id
    const control = event.currentTarget
    const message = detail.querySelector('[data-status]')
    control.disabled = true
    decodedBuffer = null
    window.clearTimeout(frequencyTimer)
    message.textContent = 'Analyzing audio…'
    try {
      const response = await fetch(`/api/musico/tracks/${trackId}/file`)
      if (!response.ok) throw new Error('Could not load audio for analysis.')
      const blob = await response.blob()
      const { parseBlob } = await import('music-metadata')
      const metadata = await parseBlob(blob, { skipCovers: true })
      if (!active() || current?.id !== trackId) return
      const format = metadata.format
      const analysis = {
        duration_ms: safeInteger(format.duration * 1000, 0, 86400000),
        bit_rate: safeInteger(format.bitrate, 1, 1000000000),
        sample_rate_hz: safeInteger(format.sampleRate, 1, 1000000),
        bit_depth: safeInteger(format.bitsPerSample, 1, 64),
        channels: safeInteger(format.numberOfChannels, 1, 64),
        codec: typeof format.codec === 'string' && format.codec.trim()
          && new TextEncoder().encode(format.codec.trim()).length <= 100
          ? format.codec.trim() : null,
        estimated_bpm: null,
        estimated_key: null,
        peak_db: null,
        average_db: null,
        dynamic_range_db: null,
      }
      let decoded = false
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (AudioContextClass) {
        const context = new AudioContextClass()
        try {
          const buffer = await context.decodeAudioData(await blob.arrayBuffer())
          if (!active() || current?.id !== trackId) return
          analysis.duration_ms ??= safeInteger(buffer.duration * 1000, 0, 86400000)
          analysis.sample_rate_hz ??= safeInteger(buffer.sampleRate, 1, 1000000)
          analysis.channels ??= safeInteger(buffer.numberOfChannels, 1, 64)
          const waveform = detail.querySelector('[data-waveform]')
          const beatWave = detail.querySelector('[data-beat-wave]')
          const spectrogram = detail.querySelector('[data-spectrogram]')
          const maxFrequency = Math.min(22050, Math.floor(buffer.sampleRate / 2))
          frequency.max = String(maxFrequency)
          frequency.min = String(Math.min(1000, maxFrequency))
          frequency.value = String(maxFrequency)
          frequencyValue.textContent = maxFrequency.toLocaleString()
          spectrogram.hidden = false
          const levels = drawAudioAnalysis(buffer, waveform, beatWave, spectrogram, maxFrequency)
          decodedBuffer = buffer
          detail.querySelector('[data-frequency-controls]').hidden = false
          const music = estimateTempoAndKey(buffer)
          analysis.estimated_bpm = music.bpm
          analysis.estimated_key = music.key
          analysis.peak_db = Number(levels.peakDb.toFixed(2))
          analysis.average_db = Number(levels.averageDb.toFixed(2))
          analysis.dynamic_range_db = Number(levels.dynamicRange.toFixed(2))
          waveform.hidden = false
          beatWave.hidden = false
          decoded = true
        } catch {
          // The browser may not decode a supported streamed format.
          detail.querySelector('[data-spectrogram]').hidden = true
          detail.querySelector('[data-frequency-controls]').hidden = true
        }
        finally { await context.close() }
      }
      const technical = detail.querySelector('[data-technical]')
      setFields(technical, analysisFields(analysis))
      technical.hidden = false
      const save = await fetch(`/api/musico/tracks/${trackId}/analysis`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"v${current.version}"` },
        body: JSON.stringify(analysis),
      })
      const saved = await save.json().catch(() => null)
      if (!save.ok) throw new Error(saved?.error ?? 'Could not save audio analysis.')
      if (!active() || current?.id !== trackId) return
      current.analysis = saved.analysis
      current.version = saved.version
      message.textContent = decoded ? 'Audio analysis complete.'
        : 'File details loaded, but this browser could not decode the audio for BPM and key analysis.'
    } catch (error) { if (active()) message.textContent = error.message }
    finally { control.disabled = false }
  })

  function showTrack(track) {
    current = track
    detail.querySelector('[data-title]').textContent = track.title
    detail.querySelector('[data-artist]').textContent = track.artist
    const art = detail.querySelector('[data-art]')
    art.hidden = !track.art_image_id
    if (track.art_image_id) art.src = `/api/media/images/${track.art_image_id}/thumbnail`
    else art.removeAttribute('src')
    art.onerror = () => { art.hidden = true }
    setFields(detail.querySelector('[data-fields]'), [
      ['Album', track.album], ['Genre', track.genre], ['Year', track.year],
      ['Track number', track.track_number], ['Rating', track.rating === null ? 'Unrated' : `${track.rating}/10`],
      ['Plays', track.play_count], ['Listen time', duration(track.listen_ms)],
      ['File', track.original_name], ['Size', `${(track.size_bytes / 1048576).toFixed(1)} MiB`],
    ])
    const download = detail.querySelector('[data-download]')
    download.href = `/api/musico/tracks/${track.id}/file`
    download.download = track.original_name
    const technical = detail.querySelector('[data-technical]')
    setFields(technical, analysisFields(track.analysis))
    technical.hidden = !technical.children.length
    detail.querySelector('[data-content]').hidden = false
  }

  async function load() {
    if (!Number.isSafeInteger(trackId) || trackId < 1) {
      detail.querySelector('[data-status]').textContent = 'Invalid song link.'
      return
    }
    try {
      const [response, track] = await requestJson('GET', `/api/musico/tracks/${trackId}`)
      if (!active()) return
      if (!response.ok) throw new Error(responseError(response, track))
      showTrack(track)
      detail.querySelector('[data-status]').textContent = ''
    } catch (error) {
      if (active()) detail.querySelector('[data-status]').textContent = error.message
    }
  }
  load()
}
