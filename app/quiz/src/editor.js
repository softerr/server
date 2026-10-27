import { mountQuestionEditor } from './questions.js'

export function renderQuizEditor(app, { requestJson, responseError, setStatus }) {
  const quizId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('quiz')
  const page = app.querySelector('#page')
  page.innerHTML = `
    <main class="quiz-editor-page">
      <a class="back-button" href="#library">← Library</a>
      <h1 class="section-title">Edit quiz</h1>
      <p id="quiz-editor-status" class="form-status" role="status" aria-live="polite">Loading quiz…</p>
      <form id="quiz-editor-form" class="quiz-editor-form" hidden>
        <label class="field">
          <span>Name</span>
          <input name="name" type="text" maxlength="100" autocomplete="off" required />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea name="description" rows="5" maxlength="1000" placeholder="What is this quiz about?"></textarea>
        </label>
        <div class="quiz-editor-actions">
          <button class="auth-button auth-button-primary" type="submit" disabled>Saved</button>
        </div>
      </form>
      <section id="question-editor-section" class="question-editor-section" aria-label="Questions" hidden></section>
      <div id="quiz-editor-save-all" class="quiz-editor-save-all" hidden>
        <p id="quiz-editor-save-all-status" class="form-status" role="status" aria-live="polite"></p>
        <button id="save-all" class="auth-button auth-button-primary" type="button" disabled>Saved</button>
      </div>
    </main>
  `

  const form = page.querySelector('#quiz-editor-form')
  const status = page.querySelector('#quiz-editor-status')
  const saveButton = form.querySelector('[type="submit"]')
  const nameInput = form.elements.namedItem('name')
  const descriptionInput = form.elements.namedItem('description')
  const saveAll = page.querySelector('#save-all')
  const saveAllWrap = page.querySelector('#quiz-editor-save-all')
  const saveAllStatus = page.querySelector('#quiz-editor-save-all-status')
  let savedValues = null
  let saving = false
  let savingAll = false
  let questionEditor = null

  function quizIsDirty() {
    return savedValues !== null && (nameInput.value !== savedValues.name
      || descriptionInput.value !== savedValues.description)
  }

  function updateSaveAllButton() {
    const dirty = quizIsDirty() || Boolean(questionEditor?.hasChanges())
    saveAll.disabled = savingAll || saving || !questionEditor?.isReady()
      || questionEditor.isSaving() || !dirty
    saveAll.textContent = savingAll ? 'Saving all…' : dirty ? 'Save all' : 'Saved'
  }

  function updateSaveButton() {
    if (saving) return
    const dirty = quizIsDirty()
    saveButton.disabled = !dirty
    saveButton.textContent = dirty ? 'Save changes' : 'Saved'
    updateSaveAllButton()
  }
  if (!quizId || !/^[1-9][0-9]*$/.test(quizId)) {
    setStatus(status, 'Quiz not found.', true)
    return
  }

  requestJson('GET', `/api/quiz/quizzes/${quizId}`).then(([response, quiz]) => {
    if (!app.contains(form)) return
    if (!response.ok) {
      setStatus(status, responseError(response, quiz), true)
      return
    }
    nameInput.value = quiz.name
    descriptionInput.value = quiz.description
    savedValues = { name: quiz.name, description: quiz.description }
    updateSaveButton()
    form.hidden = false
    const questions = page.querySelector('#question-editor-section')
    questions.hidden = false
    questionEditor = mountQuestionEditor(app, questions, quizId, {
      requestJson, responseError, setStatus,
      onChange() {
        setStatus(saveAllStatus, '')
        updateSaveAllButton()
      },
    })
    saveAllWrap.hidden = false
    updateSaveAllButton()
    setStatus(status, '')
  }).catch(() => {
    if (app.contains(form)) setStatus(status, 'Could not load quiz. Please try again.', true)
  })

  function onEdit() {
    setStatus(status, '')
    setStatus(saveAllStatus, '')
    updateSaveButton()
  }
  form.addEventListener('input', onEdit)
  form.addEventListener('change', onEdit)
  async function saveQuiz() {
    if (saving) return false
    if (!quizIsDirty()) return true
    if (!form.reportValidity()) return false
    const name = nameInput.value.trim()
    const description = descriptionInput.value.trim()
    const encoder = new TextEncoder()
    if (!name || encoder.encode(name).length > 100) {
      setStatus(status, 'Enter a quiz name of at most 100 bytes.', true)
      return false
    }
    if (encoder.encode(description).length > 1000) {
      setStatus(status, 'Description must be at most 1000 bytes.', true)
      return false
    }

    saving = true
    saveButton.disabled = true
    saveButton.textContent = 'Saving…'
    updateSaveAllButton()
    const fields = form.querySelectorAll('input, textarea')
    fields.forEach((field) => { field.disabled = true })
    setStatus(status, '')
    try {
      const [response, quiz] = await requestJson('PATCH', `/api/quiz/quizzes/${quizId}`, {
        name, description,
      })
      if (!app.contains(form)) return false
      if (!response.ok) {
        setStatus(status, responseError(response, quiz), true)
        return false
      }
      nameInput.value = quiz.name
      descriptionInput.value = quiz.description
      savedValues = { name: quiz.name, description: quiz.description }
      setStatus(status, '')
      return true
    } catch {
      if (app.contains(form)) setStatus(status, 'Could not save quiz. Please try again.', true)
      return false
    } finally {
      fields.forEach((field) => { field.disabled = false })
      saving = false
      updateSaveButton()
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!saveButton.disabled) void saveQuiz()
  })

  saveAll.addEventListener('click', async () => {
    if (saveAll.disabled || !questionEditor) return
    savingAll = true
    updateSaveAllButton()
    setStatus(saveAllStatus, '')
    try {
      if (!await saveQuiz()) {
        setStatus(saveAllStatus, 'Could not save all changes. Check the quiz details above.', true)
        return
      }
      if (!await questionEditor.saveChanges()) {
        setStatus(saveAllStatus, 'Could not save all changes. Check the question above.', true)
      }
    } catch {
      setStatus(saveAllStatus, 'Could not save all changes. Please try again.', true)
    } finally {
      savingAll = false
      updateSaveAllButton()
    }
  })
}
