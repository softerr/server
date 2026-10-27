import { editIcon, deleteIcon } from './icons.js'

const quizActionIcons = { edit: editIcon, delete: deleteIcon }

function addQuizToLibrary(list, quiz) {
  if (list.querySelector(`[data-quiz-id="${quiz.id}"]`)) return
  const item = document.createElement('li')
  item.className = 'library-item'
  item.dataset.quizId = String(quiz.id)
  const title = document.createElement('h2')
  title.className = 'library-item-title'
  title.id = `quiz-title-${quiz.id}`
  title.textContent = quiz.name
  const description = document.createElement('p')
  description.className = 'library-item-description'
  description.textContent = quiz.description ?? ''
  description.hidden = !quiz.description
  const actions = document.createElement('div')
  actions.className = 'library-item-actions'
  for (const action of ['edit', 'delete']) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'icon-action'
    button.dataset.quizAction = action
    button.setAttribute('aria-label', `${action === 'edit' ? 'Edit' : 'Delete'} quiz`)
    button.setAttribute('aria-describedby', title.id)
    button.title = `${action === 'edit' ? 'Edit' : 'Delete'} quiz`
    button.innerHTML = quizActionIcons[action]
    actions.append(button)
  }
  const details = document.createElement('div')
  details.append(title, description)
  item.append(details, actions)
  list.prepend(item)
}

export function renderLibrary(app, { requestJson, postJson, responseError, setStatus }) {
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="library-page">
      <div class="library-heading">
        <h1 class="section-title">Library</h1>
        <button id="create-quiz-button" class="auth-button auth-button-primary" type="button">Create quiz</button>
      </div>
      <p id="library-status" class="form-status" role="status" aria-live="polite">Loading quizzes…</p>
      <ul id="quiz-list" class="quiz-list" hidden></ul>
      <dialog id="quiz-name-dialog" class="quiz-dialog" aria-labelledby="quiz-name-title">
        <h2 id="quiz-name-title">Create quiz</h2>
        <form id="quiz-name-form">
          <label class="field"><span>Quiz name</span><input name="name" type="text" maxlength="100" autocomplete="off" required /></label>
          <p id="quiz-name-status" class="form-status" role="status" aria-live="polite"></p>
          <div class="dialog-actions">
            <button id="cancel-quiz-name" class="auth-button auth-button-secondary" type="button">Cancel</button>
            <button id="save-quiz-name" class="auth-button auth-button-primary" type="submit">Create</button>
          </div>
        </form>
      </dialog>
      <dialog id="delete-quiz-dialog" class="quiz-dialog" aria-labelledby="delete-quiz-title">
        <h2 id="delete-quiz-title">Delete quiz?</h2>
        <p>Delete <strong id="delete-quiz-name"></strong>? This cannot be undone.</p>
        <p id="delete-quiz-status" class="form-status" role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button id="cancel-delete-quiz" class="auth-button auth-button-secondary" type="button">Cancel</button>
          <button id="confirm-delete-quiz" class="auth-button auth-button-primary" type="button">Delete</button>
        </div>
      </dialog>
    </main>
  `

  const list = page.querySelector('#quiz-list')
  const libraryStatus = page.querySelector('#library-status')
  const dialog = page.querySelector('#quiz-name-dialog')
  const form = page.querySelector('#quiz-name-form')
  const nameInput = form.elements.name
  const nameStatus = page.querySelector('#quiz-name-status')
  const saveButton = page.querySelector('#save-quiz-name')
  const deleteDialog = page.querySelector('#delete-quiz-dialog')
  const deleteStatus = page.querySelector('#delete-quiz-status')
  const deleteButton = page.querySelector('#confirm-delete-quiz')
  const deletedQuizIds = new Set()
  let deletingQuizId = null

  fetch('/api/quiz/quizzes').then(async (response) => {
    const payload = await response.json().catch(() => null)
    if (!app.contains(list)) return
    if (!response.ok) {
      setStatus(libraryStatus, responseError(response, payload), true)
      return
    }
    for (const quiz of [...payload.quizzes].reverse()) {
      if (!deletedQuizIds.has(String(quiz.id))) addQuizToLibrary(list, quiz)
    }
    list.hidden = list.children.length === 0
    setStatus(libraryStatus, list.children.length ? '' : 'Your library is empty.')
  }).catch(() => {
    if (app.contains(list)) setStatus(libraryStatus, 'Could not load your quizzes. Please try again.', true)
  })

  page.querySelector('#create-quiz-button').addEventListener('click', () => {
    form.reset()
    setStatus(nameStatus, '')
    dialog.showModal()
    nameInput.focus()
  })
  dialog.addEventListener('cancel', (event) => {
    if (saveButton.disabled) event.preventDefault()
  })
  page.querySelector('#cancel-quiz-name').addEventListener('click', () => {
    if (!saveButton.disabled) dialog.close()
  })
  list.addEventListener('click', (event) => {
    const action = event.target.closest('[data-quiz-action]')
    const item = action?.closest('.library-item')
    if (!item || !list.contains(item)) return
    if (action.dataset.quizAction === 'edit') {
      window.location.hash = `#edit?quiz=${item.dataset.quizId}`
    } else if (action.dataset.quizAction === 'delete') {
      deletingQuizId = item.dataset.quizId
      page.querySelector('#delete-quiz-name').textContent = item.querySelector('.library-item-title').textContent
      setStatus(deleteStatus, '')
      deleteDialog.showModal()
    }
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = form.querySelector('[type="submit"]')
    if (button.disabled) return
    const name = nameInput.value.trim()
    if (!name || new TextEncoder().encode(name).length > 100) {
      setStatus(nameStatus, 'Enter a quiz name of at most 100 bytes.', true)
      return
    }
    button.disabled = true
    setStatus(nameStatus, 'Creating quiz…')
    try {
      const [response, payload] = await postJson('/api/quiz/quizzes', { name })
      if (!app.contains(form)) return
      if (!response.ok) {
        setStatus(nameStatus, responseError(response, payload), true)
        return
      }
      dialog.close()
      window.location.hash = `#edit?quiz=${payload.id}`
    } catch {
      if (app.contains(form)) setStatus(nameStatus, 'Could not connect to the service. Please try again.', true)
    } finally {
      button.disabled = false
    }
  })
  deleteDialog.addEventListener('cancel', (event) => {
    if (deleteButton.disabled) event.preventDefault()
  })
  page.querySelector('#cancel-delete-quiz').addEventListener('click', () => {
    if (!deleteButton.disabled) deleteDialog.close()
  })
  deleteButton.addEventListener('click', async () => {
    if (deleteButton.disabled || deletingQuizId === null) return
    const quizId = deletingQuizId
    deleteButton.disabled = true
    setStatus(deleteStatus, 'Deleting quiz…')
    try {
      const [response, payload] = await requestJson('DELETE', `/api/quiz/quizzes/${quizId}`)
      if (!app.contains(deleteDialog)) return
      if (!response.ok) {
        setStatus(deleteStatus, responseError(response, payload), true)
        return
      }
      deletedQuizIds.add(quizId)
      list.querySelector(`[data-quiz-id="${quizId}"]`)?.remove()
      list.hidden = list.children.length === 0
      setStatus(libraryStatus, list.hidden ? 'Your library is empty.' : '')
      deleteDialog.close()
    } catch {
      if (app.contains(deleteDialog)) setStatus(deleteStatus, 'Could not connect to the service. Please try again.', true)
    } finally {
      deleteButton.disabled = false
    }
  })
}

