const modes = ['Shuffle', 'Loop', 'Order', 'Single', 'Repeat']
const icon = (paths, viewBox = '0 0 24 24', strokeWidth = 1.8) => `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const modeIcons = {
  Shuffle: icon('<path d="M48 80h48l64 96h48m-24-24 24 24-24 24M48 176h48l64-96h48m-24-24 24 24-24 24"/>', '0 0 256 256', 16),
  Loop: icon('<path d="M64 104V80h128m-24-24 24 24-24 24m24 48v24H64m24 24-24-24 24-24"/>', '0 0 256 256', 16),
  Order: icon('<path d="M128 48v160m0 0-48-48m48 48 48-48"/>', '0 0 256 256', 16),
  Single: icon('<path d="m64 48 128 80-128 80Z"/>', '0 0 256 256', 16),
  Repeat: icon('<path d="M160 80a64 64 0 1 1-32-16l-24-24m24 24-24 24"/>', '0 0 256 256', 16),
}
const previousIcon = icon('<path d="M5 5v14M19 5l-10 7 10 7V5Z"/>')
const nextIcon = icon('<path d="M19 5v14M5 5l10 7-10 7V5Z"/>')
const playIcon = icon('<path d="m8 5 11 7-11 7V5Z"/>')
const pauseIcon = icon('<path d="M8 5v14M16 5v14"/>')
const noteIcon = icon('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>')
const timerIcon = icon('<circle cx="12" cy="13" r="8"/><path d="M12 9v5l3 2M9 2h6"/>')

export function createPlayer(requestJson) {
  const root = document.createElement('aside')
  root.className = 'musico-player-bar'
  root.hidden = true
  root.innerHTML = `
    <div class="musico-player-inner">
      <div class="musico-player-track">
        <div class="musico-player-art"><img data-art alt="" hidden><span data-art-placeholder>${noteIcon}</span></div>
        <div class="musico-player-name"><strong data-title>Nothing playing</strong><span data-artist></span></div>
      </div>
      <div class="musico-player-controls">
        <button type="button" data-previous aria-label="Previous song" title="Previous song">${previousIcon}</button>
        <button type="button" data-toggle class="musico-player-toggle" aria-label="Play" title="Play">${playIcon}</button>
        <button type="button" data-next aria-label="Next song" title="Next song">${nextIcon}</button>
      </div>
      <div class="musico-player-options">
        <button type="button" class="musico-mode-button" data-mode aria-label="Playback mode: Order"><span data-mode-icon>${modeIcons.Order}</span><span data-mode-name>Order</span></button>
        <label class="musico-timer-label">${timerIcon}<span>Stop in</span><input data-timer type="number" min="0" max="1440" step="1" value="0" aria-label="Sleep timer in minutes"><span>min</span></label>
      </div>
      <div class="musico-player-progress"><span data-current>0:00</span><input type="range" data-seek aria-label="Playback position" min="0" max="1000" value="0"><span data-duration>0:00</span></div>
    </div>
    <audio preload="metadata"></audio>
  `
  document.body.append(root)
  const audio = root.querySelector('audio')
  const mode = root.querySelector('[data-mode]')
  const toggle = root.querySelector('[data-toggle]')
  const seek = root.querySelector('[data-seek]')
  const timer = root.querySelector('[data-timer]')
  const art = root.querySelector('[data-art]')
  const artPlaceholder = root.querySelector('[data-art-placeholder]')
  let playMode
  try { playMode = localStorage.getItem('musico-play-mode') } catch { /* Storage may be unavailable. */ }
  if (!modes.includes(playMode)) playMode = 'Order'
  let queue = []
  let index = -1
  let startedId = null
  let lastTick = 0
  let pendingMs = 0
  let timerHandle = null
  const pendingEvents = new Map()

  function sendEvent(event) {
    if (event.inFlight) return
    event.inFlight = true
    requestJson('POST', `/api/musico/tracks/${event.trackId}/listen`, event.body,
      { 'Idempotency-Key': event.key }).then(([response]) => {
      if (response.ok || (response.status < 500 && response.status !== 429)) {
        pendingEvents.delete(event.key)
        return
      }
      retryEvent(event)
    }).catch(() => retryEvent(event)).finally(() => { event.inFlight = false })
  }

  function retryEvent(event) {
    event.delay = Math.min(event.delay * 2, 30000)
    window.setTimeout(() => {
      if (pendingEvents.has(event.key)) sendEvent(event)
    }, event.delay)
  }

  function recordEvent(trackId, body) {
    const event = { trackId, body, key: crypto.randomUUID(), delay: 1000, inFlight: false }
    pendingEvents.set(event.key, event)
    sendEvent(event)
  }

  function sendPendingOnExit() {
    for (const event of pendingEvents.values()) {
      fetch(`/api/musico/tracks/${event.trackId}/listen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': event.key },
        body: JSON.stringify(event.body), keepalive: true,
      }).catch(() => {})
    }
  }

  function clock(seconds) {
    if (!Number.isFinite(seconds)) return '0:00'
    const value = Math.floor(seconds)
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
  }

  function flush() {
    if (index < 0 || pendingMs < 1) return
    const id = queue[index]?.id
    const milliseconds = Math.min(60000, pendingMs)
    pendingMs -= milliseconds
    if (id) recordEvent(id, { milliseconds })
  }

  function tick(force = false) {
    if ((!force && audio.paused) || index < 0) return
    const now = Date.now()
    if (lastTick) pendingMs += Math.min(now - lastTick, 15000)
    lastTick = now
    if (pendingMs >= 10000) flush()
  }

  function update() {
    const track = queue[index]
    root.hidden = !track
    if (!track) return
    root.querySelector('[data-title]').textContent = track.title
    root.querySelector('[data-artist]').textContent = track.artist || track.album || ''
    const action = audio.paused ? 'Play' : 'Pause'
    if (toggle.title !== action) {
      toggle.innerHTML = audio.paused ? playIcon : pauseIcon
      toggle.setAttribute('aria-label', action)
      toggle.title = action
    }
    const artId = track.art_image_id ? String(track.art_image_id) : ''
    if (art.dataset.imageId !== artId) {
      art.dataset.imageId = artId
      art.hidden = !artId
      artPlaceholder.hidden = !!artId
      if (artId) art.src = `/api/media/images/${artId}/thumbnail`
      else art.removeAttribute('src')
    }
    root.querySelector('[data-current]').textContent = clock(audio.currentTime)
    root.querySelector('[data-duration]').textContent = clock(audio.duration)
    seek.value = Number.isFinite(audio.duration) && audio.duration > 0
      ? String(Math.round(audio.currentTime / audio.duration * 1000)) : '0'
    seek.style.setProperty('--seek-progress', `${Number(seek.value) / 10}%`)
  }

  function select(tracks, selectedIndex) {
    if (!tracks[selectedIndex]) return
    tick(true)
    flush()
    queue = [...tracks]
    index = selectedIndex
    startedId = null
    pendingMs = 0
    lastTick = 0
    audio.src = `/api/musico/tracks/${queue[index].id}/file`
    if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: queue[index].title, artist: queue[index].artist, album: queue[index].album,
        artwork: queue[index].art_image_id ? [{ src: `/api/media/images/${queue[index].art_image_id}`, sizes: '512x512' }] : [],
      })
    }
    update()
    audio.play().catch(() => {})
  }

  function step(direction) {
    if (!queue.length || index < 0) return
    let next
    if (playMode === 'Shuffle') {
      next = queue.length === 1 ? 0 : (index + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length
    } else if (playMode === 'Repeat') next = index
    else if (playMode === 'Single' && direction > 0) { audio.pause(); audio.currentTime = 0; update(); return }
    else next = index + direction
    if (next < 0 || next >= queue.length) {
      if (playMode !== 'Loop') { audio.pause(); update(); return }
      next = (next + queue.length) % queue.length
    }
    select(queue, next)
  }

  audio.addEventListener('playing', () => {
    if (queue[index] && startedId !== queue[index].id) {
      startedId = queue[index].id
      recordEvent(startedId, { started: true })
    }
    lastTick = Date.now()
    update()
  })
  audio.addEventListener('pause', () => { tick(true); flush(); lastTick = 0; update() })
  audio.addEventListener('timeupdate', update)
  audio.addEventListener('loadedmetadata', update)
  audio.addEventListener('ended', () => {
    tick(true); flush(); lastTick = 0
    if (playMode === 'Single') { update(); return }
    step(1)
  })
  root.querySelector('[data-previous]').addEventListener('click', () => step(-1))
  root.querySelector('[data-next]').addEventListener('click', () => step(1))
  toggle.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause() })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}))
    navigator.mediaSession.setActionHandler('pause', () => audio.pause())
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1))
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1))
    navigator.mediaSession.setActionHandler('seekto', ({ seekTime }) => {
      if (Number.isFinite(seekTime)) audio.currentTime = seekTime
    })
  }
  seek.addEventListener('input', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value) / 1000 * audio.duration
  })
  function updateMode() {
    mode.querySelector('[data-mode-icon]').innerHTML = modeIcons[playMode]
    mode.querySelector('[data-mode-name]').textContent = playMode
    const next = modes[(modes.indexOf(playMode) + 1) % modes.length]
    mode.setAttribute('aria-label', `Playback mode: ${playMode}. Click for ${next}`)
    mode.title = `Playback mode: ${playMode}. Click for ${next}`
  }
  updateMode()
  mode.addEventListener('click', () => {
    playMode = modes[(modes.indexOf(playMode) + 1) % modes.length]
    updateMode()
    try { localStorage.setItem('musico-play-mode', playMode) } catch { /* Keep it for this page. */ }
  })
  art.addEventListener('error', () => { art.hidden = true; artPlaceholder.hidden = false })
  timer.addEventListener('change', () => {
    window.clearTimeout(timerHandle)
    const minutes = Number(timer.value)
    if (Number.isInteger(minutes) && minutes > 0 && minutes <= 1440) {
      timerHandle = window.setTimeout(() => { audio.pause(); timer.value = '0' }, minutes * 60000)
    } else timer.value = '0'
  })
  window.setInterval(tick, 5000)
  window.addEventListener('pagehide', () => { tick(true); flush(); sendPendingOnExit() })

  return {
    select,
    stop() { tick(true); flush(); audio.pause(); audio.removeAttribute('src'); audio.load(); queue = []; index = -1; window.clearTimeout(timerHandle); timer.value = '0'; update() },
    remove(id) { if (queue[index]?.id === id) { this.stop() } else queue = queue.filter((track) => track.id !== id) },
    updateTrack(track) { queue = queue.map((item) => item.id === track.id ? track : item); update() },
  }
}
