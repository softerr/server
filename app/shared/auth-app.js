export function startAuthApp(config) {
  const app = document.querySelector('#app')
  let signedUpEmail = ''
  let currentUser = null
  let authReady = false

  function currentView() {
    const view = window.location.hash.slice(1).split('?')[0]
    if (['signup', 'login', 'forgot-password', 'reset'].includes(view)) return view
    if (config.publicViews?.includes(view)) return view
    if (currentUser && config.views.includes(view)) return view
    return config.defaultView ?? (currentUser ? 'home' : 'login')
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

  async function requestJson(method, path, data) {
    const options = { method }
    if (data !== undefined) {
      options.headers = { 'Content-Type': 'application/json' }
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (timezone) options.headers['X-Timezone'] = timezone
      options.body = JSON.stringify(data)
    }
    const response = await fetch(path, options)
    return [response, await response.json().catch(() => null)]
  }

  function postJson(path, data) {
    return requestJson('POST', path, data)
  }

  function renderHome() {
    const page = app.querySelector('#page')
    page.innerHTML = '<main id="center"><p class="home-message">Welcome back.</p></main>'
  }

  function renderSection(title, description) {
    const page = app.querySelector('#page')
    page.innerHTML = `<main id="center"><h1 class="section-title">${title}</h1><p class="section-description">${description}</p></main>`
  }

  function renderLogin() {
    const page = app.querySelector('#page')
    page.innerHTML = `
      <main id="center">
        <section class="panel" aria-labelledby="login-title">
          <h1 id="login-title">Log in</h1>
          <form id="login-form" class="login-form">
            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
            <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label>
            <div class="form-help"><button class="text-button" type="button" data-view="forgot-password">Forgot password?</button></div>
            <button class="auth-button auth-button-primary" type="submit">Log in</button>
          </form>
          <p id="login-status" class="form-status" role="status" aria-live="polite"></p>
          <div class="auth-switch"><span>${config.signupPrompt}</span><button class="text-button" type="button" data-view="signup">Sign up</button></div>
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
        const destination = window.location.hash.slice(1).split('?')[0]
        navigate([...config.views, ...(config.publicViews ?? [])].includes(destination) ? destination : 'home')
      } catch {
        if (app.contains(form)) setStatus(status, 'Could not connect to the service. Please try again.', true)
      } finally {
        button.disabled = false
      }
    })
  }

  function renderForgotPassword() {
    const page = app.querySelector('#page')
    page.innerHTML = `
      <main id="center">
        <section class="panel" aria-labelledby="forgot-title">
          <button class="back-button" type="button" data-view="login">← Back to log in</button>
          <h1 id="forgot-title">Reset password</h1>
          <p>Enter your account email to request a reset link.</p>
          <form id="forgot-form">
            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
            <button class="auth-button auth-button-primary" type="submit">Send reset link</button>
          </form>
          <p id="forgot-status" class="form-status" role="status" aria-live="polite"></p>
        </section>
      </main>
    `
    const form = app.querySelector('#forgot-form')
    const status = app.querySelector('#forgot-status')
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const button = form.querySelector('[type="submit"]')
      if (button.disabled) return
      const fields = new FormData(form)
      button.disabled = true
      setStatus(status, 'Requesting a reset link…')
      try {
        const [response, payload] = await postJson('/api/auth/password-reset/request', {
          email: String(fields.get('email') ?? ''),
        })
        if (!app.contains(form)) return
        setStatus(status, response.ok
          ? 'If this account exists, a reset link will arrive by email.'
          : responseError(response, payload), !response.ok)
      } catch {
        if (app.contains(form)) setStatus(status, 'Could not connect to the service. Please try again.', true)
      } finally {
        button.disabled = false
      }
    })
  }

  function renderResetPassword() {
    const fragment = window.location.hash.slice(1)
    const token = new URLSearchParams(fragment.split('?')[1] ?? '').get('token') ?? ''
    const page = app.querySelector('#page')
    page.innerHTML = `
      <main id="center">
        <section class="panel" aria-labelledby="reset-title">
          <button class="back-button" type="button" data-view="login">← Back to log in</button>
          <h1 id="reset-title">New password</h1>
          <form id="reset-form">
            <label class="field"><span>New password</span><input name="password" type="password" autocomplete="new-password" required /></label>
            <label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" required /></label>
            <button class="auth-button auth-button-primary" type="submit">Update password</button>
          </form>
          <p id="reset-status" class="form-status" role="status" aria-live="polite"></p>
        </section>
      </main>
    `
    const form = app.querySelector('#reset-form')
    const status = app.querySelector('#reset-status')
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      form.hidden = true
      setStatus(status, 'This reset link is invalid. Request a new one from the login screen.', true)
      return
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const button = form.querySelector('[type="submit"]')
      if (button.disabled) return
      const fields = new FormData(form)
      const password = String(fields.get('password') ?? '')
      if (password !== String(fields.get('confirm') ?? '')) {
        setStatus(status, 'Passwords do not match.', true)
        return
      }
      button.disabled = true
      setStatus(status, 'Updating password…')
      try {
        const [response, payload] = await postJson('/api/auth/password-reset/confirm', { token, password })
        if (!app.contains(form)) return
        if (!response.ok) {
          setStatus(status, responseError(response, payload), true)
          return
        }
        currentUser = null
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#login`)
        render()
        setStatus(app.querySelector('#login-status'), 'Password updated. Please log in.')
      } catch {
        if (app.contains(form)) setStatus(status, 'Could not connect to the service. Please try again.', true)
      } finally {
        button.disabled = false
      }
    })
  }

  function renderSignup() {
    signedUpEmail = ''
    const page = app.querySelector('#page')
    page.innerHTML = `
      <main id="center">
        <section class="panel" aria-labelledby="signup-title">
          <button class="back-button" type="button" data-view="login">← Back to log in</button>
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
          <div class="auth-switch"><span>Already have an account?</span><button class="text-button" type="button" data-view="login">Log in</button></div>
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
    const links = (currentUser || config.showLinksWhenLoggedOut) && config.links.length
      ? `<div class="site-links">${config.links.map(({ view: linkView, label }) =>
          `<a class="site-link${view === linkView ? ' is-active' : ''}" href="#${linkView}"${view === linkView ? ' aria-current="page"' : ''}>${label}</a>`
        ).join('')}</div>`
      : ''
    app.innerHTML = `
      <header class="site-header">
        <nav class="site-nav" aria-label="${config.name} navigation">
          <a class="site-brand" href="${config.homeHref}">${config.name}</a>
          ${currentUser
            ? `${links}<div class="site-account"><span id="nav-username"></span><button class="nav-logout" type="button" id="logout-button">Log out</button></div>`
            : `${links}${config.showGuestLogin ? '<button class="nav-login" type="button" data-view="login">Log in</button>' : ''}`}
        </nav>
      </header>
      <div id="page"></div>
    `
    if (currentUser) app.querySelector('#nav-username').textContent = currentUser.username
    if (!authReady && !config.publicViews?.includes(view)) {
      app.querySelector('#page').innerHTML = '<main id="center" role="status">Checking session…</main>'
      return
    }
    if (view === 'signup') renderSignup()
    else if (view === 'login') renderLogin()
    else if (view === 'forgot-password') renderForgotPassword()
    else if (view === 'reset') renderResetPassword()
    else if (!config.renderView?.(view, app, { renderSection, requestJson, postJson, responseError, setStatus })) renderHome()
  }

  app.addEventListener('click', (event) => {
    if (event.target.closest('#logout-button')) {
      postJson('/api/auth/logout', {}).then(([response]) => {
        if (response.ok) {
          currentUser = null
          navigate('home')
        }
      }).catch(() => {})
      return
    }
    const button = event.target.closest('[data-view]')
    if (button && app.contains(button)) navigate(button.dataset.view)
  })
  window.addEventListener('hashchange', render)
  render()
  const sessionCheck = new AbortController()
  const sessionCheckTimeout = window.setTimeout(() => sessionCheck.abort(), 5000)
  fetch('/api/auth/me', { signal: sessionCheck.signal }).then(async (response) => {
    if (response.ok) {
      currentUser = await response.json()
    }
  }).catch(() => {}).finally(() => {
    window.clearTimeout(sessionCheckTimeout)
    authReady = true
    render()
  })
}
