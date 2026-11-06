import './style.css'
import { startAuthApp } from '../../shared/auth-app.js'
import { renderDiscover } from './discover.js'
import { renderSongDetails } from './details.js'
import { renderSongs } from './songs.js'
import { renderPlaylists } from './playlists.js'
import { renderStats } from './stats.js'
import { stopMusicPlayer, updateMusicTrack } from './view-ui.js'

const accent = localStorage.getItem('musico-accent')
if (/^#[0-9a-f]{6}$/i.test(accent || '')) document.documentElement.style.setProperty('--accent', accent)

startAuthApp({
  name: 'Musico',
  homeHref: '/musico/',
  signupPrompt: 'New to Musico?',
  onLogout() { stopMusicPlayer() },
  views: ['songs', 'playlists', 'stats', 'discover', 'details'],
  links: [
    { view: 'songs', label: 'Songs' },
    { view: 'playlists', label: 'Playlists' },
    { view: 'stats', label: 'Stats' },
    { view: 'discover', label: 'Discover' },
  ],
  renderView(view, app, helpers) {
    if (view === 'home' || view === 'songs') {
      renderSongs(app, helpers)
      return true
    }
    if (view === 'playlists') {
      renderPlaylists(app, helpers)
      return true
    }
    if (view === 'stats') {
      renderStats(app, helpers)
      return true
    }
    if (view === 'discover') {
      renderDiscover(app, helpers)
      return true
    }
    if (view === 'details') {
      renderSongDetails(app, { ...helpers, onTrackUpdated: (track) => updateMusicTrack(track) })
      return true
    }
    return false
  },
})
