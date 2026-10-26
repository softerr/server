import './style.css'
import { startAuthApp } from '../../shared/auth-app.js'
import { renderLibrary } from './library.js'

startAuthApp({
  name: 'Quiz',
  homeHref: '/quiz/',
  signupPrompt: 'New to Quiz?',
  views: ['explore', 'library'],
  links: [
    { view: 'explore', label: 'Explore' },
    { view: 'library', label: 'Library' },
  ],
  renderView(view, app, helpers) {
    if (view === 'explore') {
      helpers.renderSection('Explore', 'No quizzes available yet.')
      return true
    }
    if (view === 'library') {
      renderLibrary(app, helpers)
      return true
    }
    return false
  },
})
