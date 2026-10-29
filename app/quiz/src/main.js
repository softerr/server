import './style.css'
import { startAuthApp } from '../../shared/auth-app.js'
import { renderLibrary } from './library.js'
import { renderExplore } from './explore.js'
import { renderQuizEditor } from './editor.js'
import { renderQuizPlay } from './play.js'
import { renderQuizAttempts, renderQuizAttempt, renderQuizResults } from './attempts.js'

startAuthApp({
  name: 'Quiz',
  homeHref: '/quiz/',
  signupPrompt: 'New to Quiz?',
  views: ['explore', 'library', 'edit', 'play', 'results', 'attempts', 'attempt'],
  links: [
    { view: 'explore', label: 'Explore' },
    { view: 'library', label: 'Library' },
  ],
  renderView(view, app, helpers) {
    if (view === 'explore') {
      renderExplore(app, helpers)
      return true
    }
    if (view === 'library') {
      renderLibrary(app, helpers)
      return true
    }
    if (view === 'edit') {
      renderQuizEditor(app, helpers)
      return true
    }
    if (view === 'play') {
      renderQuizPlay(app, helpers)
      return true
    }
    if (view === 'results') {
      renderQuizResults(app, helpers)
      return true
    }
    if (view === 'attempts') {
      renderQuizAttempts(app, helpers)
      return true
    }
    if (view === 'attempt') {
      renderQuizAttempt(app, helpers)
      return true
    }
    return false
  },
})
