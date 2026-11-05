import { drawAudioAnalysis } from './audio-analysis.js'
import { estimateTempoAndKey } from './music-theory.js'

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

export function createSongDetails() {
  const dialog = document.createElement('dialog')
  dialog.className = 'musico-dialog musico-details-dialog'
  dialog.innerHTML = `
    <div class="musico-art-heading"><h2>Song details</h2><button type="button" data-close aria-label="Close song details">×</button></div>
    <div class="musico-details-heading"><img data-art alt="" hidden><div><strong data-title></strong><span data-artist></span></div></div>
    <dl data-fields class="musico-details-fields"></dl>
    <div class="musico-details-actions"><a data-download class="auth-button auth-button-secondary">Download audio</a><button data-copy type="button" class="auth-button auth-button-secondary">Copy song name</button><button data-analyze type="button" class="auth-button auth-button-secondary">Analyze audio</button></div>
    <p data-status class="form-status" role="status" aria-live="polite"></p>
    <canvas data-waveform width="640" height="120" aria-label="Audio waveform" hidden></canvas>
    <canvas data-beat-wave width="640" height="80" aria-label="Audio energy over time" hidden></canvas>
    <canvas data-spectrogram width="320" height="128" aria-label="Audio frequency spectrogram" hidden></canvas>
    <dl data-technical class="musico-details-fields"></dl>
  `
  document.body.append(dialog)
  let current = null
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close())

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

  dialog.querySelector('[data-copy]').addEventListener('click', async () => {
    if (!current) return
    try {
      await navigator.clipboard.writeText(`${current.artist} - ${current.title}`)
      dialog.querySelector('[data-status]').textContent = 'Song name copied.'
    } catch { dialog.querySelector('[data-status]').textContent = 'Could not copy song name.' }
  })

  dialog.querySelector('[data-analyze]').addEventListener('click', async (event) => {
    if (!current) return
    const trackId = current.id
    const control = event.currentTarget
    const message = dialog.querySelector('[data-status]')
    control.disabled = true
    message.textContent = 'Analyzing audio…'
    try {
      const response = await fetch(`/api/musico/tracks/${trackId}/file`)
      if (!response.ok) throw new Error('Could not load audio for analysis.')
      const blob = await response.blob()
      const { parseBlob } = await import('music-metadata')
      const metadata = await parseBlob(blob, { skipCovers: true })
      if (!dialog.open || current?.id !== trackId) return
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
          if (!dialog.open || current?.id !== trackId) return
          analysis.duration_ms ??= safeInteger(buffer.duration * 1000, 0, 86400000)
          analysis.sample_rate_hz ??= safeInteger(buffer.sampleRate, 1, 1000000)
          analysis.channels ??= safeInteger(buffer.numberOfChannels, 1, 64)
          const waveform = dialog.querySelector('[data-waveform]')
          const beatWave = dialog.querySelector('[data-beat-wave]')
          const spectrogram = dialog.querySelector('[data-spectrogram]')
          const levels = drawAudioAnalysis(buffer, waveform, beatWave, spectrogram)
          const music = estimateTempoAndKey(buffer)
          analysis.estimated_bpm = music.bpm
          analysis.estimated_key = music.key
          analysis.peak_db = Number(levels.peakDb.toFixed(2))
          analysis.average_db = Number(levels.averageDb.toFixed(2))
          analysis.dynamic_range_db = Number(levels.dynamicRange.toFixed(2))
          waveform.hidden = false
          beatWave.hidden = false
          spectrogram.hidden = false
          decoded = true
        } catch { /* The browser may not decode a supported streamed format. */ }
        finally { await context.close() }
      }
      setFields(dialog.querySelector('[data-technical]'), analysisFields(analysis))
      const save = await fetch(`/api/musico/tracks/${trackId}/analysis`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"v${current.version}"` },
        body: JSON.stringify(analysis),
      })
      const saved = await save.json().catch(() => null)
      if (!save.ok) throw new Error(saved?.error ?? 'Could not save audio analysis.')
      if (!dialog.open || current?.id !== trackId) return
      current.analysis = saved.analysis
      current.version = saved.version
      message.textContent = decoded ? 'Audio analysis complete.'
        : 'File details loaded, but this browser could not decode the audio for BPM and key analysis.'
    } catch (error) { if (dialog.open) message.textContent = error.message }
    finally { control.disabled = false }
  })

  return {
    open(track) {
      current = track
      dialog.querySelector('[data-title]').textContent = track.title
      dialog.querySelector('[data-artist]').textContent = track.artist
      const art = dialog.querySelector('[data-art]')
      art.hidden = !track.art_image_id
      if (track.art_image_id) art.src = `/api/media/images/${track.art_image_id}/thumbnail`
      else art.removeAttribute('src')
      art.onerror = () => { art.hidden = true }
      setFields(dialog.querySelector('[data-fields]'), [
        ['Album', track.album], ['Genre', track.genre], ['Year', track.year],
        ['Track number', track.track_number], ['Rating', track.rating === null ? 'Unrated' : `${track.rating}/10`],
        ['Plays', track.play_count], ['Listen time', duration(track.listen_ms)],
        ['File', track.original_name], ['Size', `${(track.size_bytes / 1048576).toFixed(1)} MiB`],
      ])
      const download = dialog.querySelector('[data-download]')
      download.href = `/api/musico/tracks/${track.id}/file`
      download.download = track.original_name
      dialog.querySelector('[data-status]').textContent = ''
      setFields(dialog.querySelector('[data-technical]'), analysisFields(track.analysis))
      dialog.querySelector('[data-waveform]').hidden = true
      dialog.querySelector('[data-beat-wave]').hidden = true
      dialog.querySelector('[data-spectrogram]').hidden = true
      dialog.showModal()
    },
    close() { if (dialog.open) dialog.close() },
  }
}
