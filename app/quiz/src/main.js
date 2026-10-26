import './style.css'

const app = document.querySelector('#app')
let signedUpEmail = ''
let currentUser = null

function currentView() {
  const view = window.location.hash.slice(1)
  return view === 'signup' || view === 'login' ? view : 'home'
}

function navigate(view) {
  const hash = view === 'home' ? '' : `#${view}`
  if (window.location.hash === hash) render()
  else window.location.hash = hash
}

function responseError(response, payload) {
  if (response.status === 429) return 'Too many requests. Please wait and try again.'
  if (response.status === 413) return 'The request is too large.'
  if (response.status >= 500) return 'The service is unavailable. Please try again later.'
  return typeof payload?.error === 'string' ? payload.error : 'The request could not be completed.'
}

function setStatus(element, message, isError = false) {
  element.textContent = message
  element.classList.toggle('error', isError)
}

async function postJson(path, data) {
  const headers = { 'Content-Type': 'application/json' }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (timezone) headers['X-Timezone'] = timezone
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(data) })
  return [response, await response.json().catch(() => null)]
}

function renderHome() {
  app.innerHTML = `
    <main id="center">
      <h1>Quiz</h1>
      <nav class="auth-actions" aria-label="Account">
        ${currentUser
          ? '<span id="account-name"></span><button class="auth-button auth-button-secondary" type="button" id="logout-button">Log out</button>'
          : '<button class="auth-button auth-button-secondary" type="button" data-view="login">Log in</button><button class="auth-button auth-button-primary" type="button" data-view="signup">Sign up</button>'}
      </nav>
    </main>
  `
  if (currentUser) app.querySelector('#account-name').textContent = currentUser.username
}

function renderLogin() {
  app.innerHTML = `
    <main id="center">
      <section class="panel" aria-labelledby="login-title">
        <button class="back-button" type="button" data-view="home">← Back to quiz</button>
        <h1 id="login-title">Log in</h1>
        <form id="login-form" class="login-form">
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label>
          <button class="auth-button auth-button-secondary" type="submit">Log in</button>
        </form>
        <p id="login-status" class="form-status" role="status" aria-live="polite"></p>
        <button class="auth-button auth-button-primary" type="button" data-view="signup">Sign up</button>
      </section>
    </main>
  `

  const form = app.querySelector('#login-form')
  const status = app.querySelector('#login-status')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = form.querySelector('[type="submit"]')
    if (button.disabled) return
    const fields = new FormData(form)
    button.disabled = true
    setStatus(status, 'Logging in…')
    try {
      const [response, payload] = await postJson('/api/auth/login', {
        email: String(fields.get('email') ?? ''),
        password: String(fields.get('password') ?? ''),
      })
      if (!app.contains(form)) return
      if (!response.ok) {
        setStatus(status, responseError(response, payload), true)
        return
      }
      currentUser = payload
      navigate('home')
    } catch {
      if (app.contains(form)) setStatus(status, 'Could not connect to the service. Please try again.', true)
    } finally {
      button.disabled = false
    }
  })
}

function renderSignup() {
  signedUpEmail = ''
  app.innerHTML = `
    <main id="center">
      <section class="panel" aria-labelledby="signup-title">
        <button class="back-button" type="button" data-view="home">← Back to quiz</button>
        <h1 id="signup-title">Create an account</h1>
        <p>Sign up to get a verification link by email.</p>
        <form id="signup-form">
          <label class="field"><span>Username</span><input name="username" type="text" autocomplete="username" required /></label>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" required /></label>
          <button class="auth-button auth-button-primary" type="submit">Create account</button>
        </form>
        <p id="signup-status" class="form-status" role="status" aria-live="polite"></p>
        <div id="signup-result" hidden>
          <h2>Check your email</h2>
          <p>A verification link has been queued for <strong id="signup-email"></strong>.</p>
          <p>Open the link in the email to verify your account.</p>
          <button class="auth-button auth-button-secondary" type="button" id="resend-button">Resend verification email</button>
        </div>
      </section>
    </main>
  `

  const form = app.querySelector('#signup-form')
  const status = app.querySelector('#signup-status')
  const result = app.querySelector('#signup-result')
  const resendButton = app.querySelector('#resend-button')

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const submitButton = form.querySelector('[type="submit"]')
    if (submitButton.disabled) return
    const fields = new FormData(form)
    const email = String(fields.get('email') ?? '').trim()

    submitButton.disabled = true
    setStatus(status, 'Creating your account…')
    try {
      const [response, payload] = await postJson('/api/auth/signup', {
        username: String(fields.get('username') ?? ''),
        email,
        password: String(fields.get('password') ?? ''),
      })
      if (!app.contains(form)) return
      if (!response.ok) {
        setStatus(status, responseError(response, payload), true)
        return
      }

      signedUpEmail = email
      form.hidden = true
      status.textContent = ''
      app.querySelector('#signup-email').textContent = email
      result.hidden = false
    } catch {
      if (app.contains(form)) setStatus(status, 'Could not connect to the service. Please try again.', true)
    } finally {
      submitButton.disabled = false
    }
  })

  resendButton.addEventListener('click', async () => {
    if (!signedUpEmail || resendButton.disabled) return
    resendButton.disabled = true
    setStatus(status, 'Requesting another verification email…')
    try {
      const [response, payload] = await postJson('/api/auth/resend-verification', { email: signedUpEmail })
      if (!app.contains(resendButton)) return
      setStatus(status, response.ok
        ? 'Request accepted. If eligible, another email will arrive shortly.'
        : responseError(response, payload), !response.ok)
    } catch {
      if (app.contains(resendButton)) setStatus(status, 'Could not connect to the service. Please try again.', true)
    } finally {
      resendButton.disabled = false
    }
  })
}

function render() {
  const view = currentView()
  if (view === 'signup') renderSignup()
  else if (view === 'login') renderLogin()
  else renderHome()
}

app.addEventListener('click', (event) => {
  if (event.target.closest('#logout-button')) {
    postJson('/api/auth/logout', {}).then(([response]) => {
      if (response.ok) {
        currentUser = null
        render()
      }
    }).catch(() => {})
    return
  }
  const button = event.target.closest('[data-view]')
  if (button && app.contains(button)) navigate(button.dataset.view)
})
window.addEventListener('hashchange', render)
render()
fetch('/api/auth/me').then(async (response) => {
  if (response.ok) {
    currentUser = await response.json()
    render()
  }
}).catch(() => {})
