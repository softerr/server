import './style.css'
import { startAuthApp } from '../../shared/auth-app.js'

startAuthApp({
  name: 'Home',
  homeHref: '/',
  signupPrompt: 'New here?',
  defaultView: 'apps',
  publicViews: ['apps'],
  views: [],
  links: [{ view: 'apps', label: 'Apps' }],
  showLinksWhenLoggedOut: true,
  showGuestLogin: true,
  renderView(view, app) {
    if (view !== 'apps') return false
    app.querySelector('#page').innerHTML = `
      <main class="apps-page">
        <h1 class="section-title">Apps</h1>
        <div class="apps-grid">
          <a class="app-card" href="/quiz/">
            <span class="app-card-title">Quiz</span>
            <span class="app-card-description">Open your quizzes</span>
          </a>
        </div>
      </main>
    `
    return true
  },
})
