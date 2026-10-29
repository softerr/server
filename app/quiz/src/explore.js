function addExploreQuiz(list, quiz) {
  const item = document.createElement('li')
  item.className = 'library-item explore-item'
  const link = document.createElement('a')
  link.className = 'library-item-open'
  link.href = `#play?quiz=${quiz.id}&source=explore`
  link.setAttribute('aria-label', `Play ${quiz.name}`)
  const title = document.createElement('h2')
  title.className = 'library-item-title'
  title.textContent = quiz.name
  const description = document.createElement('p')
  description.className = 'library-item-description'
  description.textContent = quiz.description || ''
  description.hidden = !quiz.description
  const plays = document.createElement('span')
  plays.className = 'library-item-plays'
  plays.textContent = `${quiz.play_count} ${quiz.play_count === 1 ? 'play' : 'plays'}`
  link.append(title, description, plays)
  item.append(link)
  list.append(item)
}

export function renderExplore(app, { requestJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="library-page">
      <h1 class="section-title">Explore</h1>
      <p id="explore-status" class="form-status" role="status" aria-live="polite">Loading public quizzes…</p>
      <ul id="explore-list" class="quiz-list" hidden></ul>
      <button id="explore-more" class="auth-button auth-button-secondary" type="button" hidden>Load more</button>
    </main>
  `
  const list = page.querySelector('#explore-list')
  const status = page.querySelector('#explore-status')
  const more = page.querySelector('#explore-more')
  let nextBefore = null

  async function load(before = null) {
    more.disabled = true
    try {
      const path = `/api/quiz/explore${before ? `?before=${before}` : ''}`
      const [response, payload] = await requestJson('GET', path)
      if (!app.contains(list)) return
      if (!response.ok) { setStatus(status, responseError(response, payload), true); return }
      for (const quiz of payload.quizzes || []) addExploreQuiz(list, quiz)
      nextBefore = payload.next_before
      list.hidden = !list.children.length
      more.hidden = nextBefore === null
      setStatus(status, list.children.length ? '' : 'No public quizzes yet.')
    } catch {
      if (app.contains(list)) setStatus(status, 'Could not load public quizzes. Please try again.', true)
    } finally { more.disabled = false }
  }

  more.addEventListener('click', () => { if (nextBefore !== null) void load(nextBefore) })
  void load()
}
