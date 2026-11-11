import { createPageNotice } from '../../shared/page-notice.js'

const databaseIcon = `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
  <ellipse cx="24" cy="10" rx="17" ry="6" />
  <path d="M7 10v28c0 3.3 7.6 6 17 6s17-2.7 17-6V10" />
  <path d="M7 24c0 3.3 7.6 6 17 6s17-2.7 17-6M7 31c0 3.3 7.6 6 17 6s17-2.7 17-6" />
</svg>`
export function renderDatabases(app, { requestJson, postJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="mdb-page">
      <header class="mdb-heading"><h1 class="section-title">Databases</h1></header>
      <p id="mdb-status" class="form-status" role="status" aria-live="polite"></p>
      <section id="mdb-grid" class="mdb-grid" aria-label="Your databases"></section>
    </main>
    <dialog id="mdb-create-dialog" class="mdb-dialog" aria-labelledby="mdb-create-title">
      <h2 id="mdb-create-title">Create database</h2>
      <form id="mdb-create-form">
        <label class="field"><span>Name</span><input name="name" maxlength="100" required autocomplete="off" /></label>
        <p id="mdb-create-status" class="form-status" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button id="mdb-create-cancel" class="auth-button auth-button-secondary" type="button">Cancel</button>
          <button class="auth-button auth-button-primary" type="submit">Create</button>
        </div>
      </form>
    </dialog>
  `

  const notice = createPageNotice(page.querySelector('.mdb-page'))
  const grid = page.querySelector('#mdb-grid')
  const status = page.querySelector('#mdb-status')
  const dialog = page.querySelector('#mdb-create-dialog')
  const form = page.querySelector('#mdb-create-form')
  const formStatus = page.querySelector('#mdb-create-status')

  function showDatabases(databases) {
    grid.replaceChildren()
    const create = document.createElement('button')
    create.type = 'button'
    create.className = 'mdb-card mdb-card-create'
    create.innerHTML = '<span class="mdb-create-icon" aria-hidden="true">+</span><strong>Create database</strong>'
    create.addEventListener('click', () => {
      form.reset()
      setStatus(formStatus, '')
      dialog.showModal()
      form.elements.name.focus()
    })
    grid.append(create)
    for (const database of databases) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'mdb-card'
      card.innerHTML = `<span class="mdb-card-icon">${databaseIcon}</span><h2></h2>`
      card.querySelector('h2').textContent = database.name
      card.addEventListener('click', () => { window.location.hash = `database?id=${database.id}` })
      grid.append(card)
    }
  }

  async function loadDatabases() {
    setStatus(status, 'Loading databases…')
    try {
      const [response, payload] = await requestJson('GET', '/api/mdb/databases')
      if (!page.isConnected) return false
      if (!response.ok) {
        setStatus(status, responseError(response, payload), true)
        return false
      }
      showDatabases(payload.databases)
      setStatus(status, '')
      return true
    } catch {
      if (page.isConnected) setStatus(status, 'Could not load databases. Please try again.', true)
      return false
    }
  }

  page.querySelector('#mdb-create-cancel').addEventListener('click', () => dialog.close())
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = form.querySelector('[type="submit"]')
    if (button.disabled) return
    button.disabled = true
    setStatus(formStatus, '')
    try {
      const [response, payload] = await postJson('/api/mdb/databases', { name: form.elements.name.value.trim() })
      if (!page.isConnected) return
      if (!response.ok) {
        setStatus(formStatus, responseError(response, payload), true)
        return
      }
      dialog.close()
      if (await loadDatabases()) notice.show(`Database “${payload.name}” created.`)
    } catch {
      if (page.isConnected) setStatus(formStatus, 'Could not create database. Please try again.', true)
    } finally {
      button.disabled = false
    }
  })

  loadDatabases()
}

