export function renderDiscover(app, { requestJson, responseError }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="musico-page">
      <div class="musico-heading"><h1 class="section-title">Discover</h1><button id="refresh-discovery" type="button" class="auth-button auth-button-secondary">Refresh</button></div>
      <p id="discover-status" class="form-status" role="status" aria-live="polite">Finding music…</p>
      <div id="discover-results" class="musico-discover-grid"></div>
    </main>
  `
  const results = page.querySelector('#discover-results')
  const message = page.querySelector('#discover-status')
  const refresh = page.querySelector('#refresh-discovery')

  async function search(term, limit) {
    const url = new URL('https://itunes.apple.com/search')
    url.search = new URLSearchParams({ term, media: 'music', entity: 'song', limit: String(limit) })
    const response = await fetch(url)
    if (!response.ok) throw new Error('Music discovery is unavailable.')
    return (await response.json()).results ?? []
  }

  async function load() {
    refresh.disabled = true
    message.textContent = 'Finding music…'
    results.replaceChildren()
    try {
      const [response, payload] = await requestJson('GET', '/api/musico/tracks')
      if (!response.ok) throw new Error(responseError(response, payload))
      const tracks = payload.tracks ?? []
      const artistScores = new Map()
      const genreScores = new Map()
      const known = new Set()
      for (const track of tracks) {
        known.add(`${track.title}::${track.artist}`.toLocaleLowerCase())
        const score = 1 + Math.max(0, track.rating ?? 0) / 10 + Math.log1p(track.play_count)
        if (track.artist) artistScores.set(track.artist, (artistScores.get(track.artist) ?? 0) + score)
        for (const genre of track.genre.split(/[/;,]/).map((value) => value.trim()).filter(Boolean)) {
          genreScores.set(genre, (genreScores.get(genre) ?? 0) + score)
        }
      }
      if (!tracks.length) {
        message.textContent = 'Upload songs to get personalized suggestions.'
        return
      }
      const top = (scores, count) => [...scores].sort((a, b) => b[1] - a[1]).slice(0, count).map(([name]) => name)
      const terms = [...top(artistScores, 3), ...top(genreScores, 2)]
      const searches = await Promise.allSettled(terms.map((term) => search(term, 50)))
      if (!app.contains(page)) return
      const suggestions = new Map()
      for (const result of searches) {
        if (result.status !== 'fulfilled') continue
        for (const item of result.value) {
          if (item.kind !== 'song' || !item.trackName || !item.artistName) continue
          const key = `${item.trackName}::${item.artistName}`.toLocaleLowerCase()
          if (known.has(key) || suggestions.has(key)) continue
          const score = (artistScores.get(item.artistName) ?? 0) * 2 + (genreScores.get(item.primaryGenreName) ?? 0)
          suggestions.set(key, { ...item, score })
        }
      }
      for (const suggestion of [...suggestions.values()].sort((a, b) => b.score - a.score).slice(0, 60)) {
        const card = document.createElement('a')
        card.className = 'musico-discover-card'
        card.href = `https://music.youtube.com/search?${new URLSearchParams({ q: `${suggestion.trackName} ${suggestion.artistName}` })}`
        card.target = '_blank'
        card.rel = 'noopener noreferrer'
        if (suggestion.artworkUrl100) {
          const image = document.createElement('img')
          image.src = suggestion.artworkUrl100.replace('100x100', '300x300')
          image.alt = ''
          image.loading = 'lazy'
          card.append(image)
        }
        const name = document.createElement('strong')
        name.textContent = suggestion.trackName
        const info = document.createElement('span')
        info.textContent = [suggestion.artistName, suggestion.collectionName, suggestion.primaryGenreName].filter(Boolean).join(' · ')
        card.append(name, info)
        results.append(card)
      }
      message.textContent = results.childElementCount ? '' : 'No suggestions found right now.'
    } catch (error) {
      if (app.contains(page)) message.textContent = error.message
    } finally { if (app.contains(page)) refresh.disabled = false }
  }
  refresh.addEventListener('click', load)
  load()
}
