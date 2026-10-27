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
        <button id="export-quiz" class="auth-button auth-button-secondary" type="button" title="Export saved quiz as JSON" disabled>Export JSON</button>
        <button id="export-quiz-zip" class="auth-button auth-button-secondary" type="button" title="Export saved quiz with images as ZIP" disabled>Export ZIP</button>
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
  const exportButton = page.querySelector('#export-quiz')
  const exportZipButton = page.querySelector('#export-quiz-zip')
  const saveAllWrap = page.querySelector('#quiz-editor-save-all')
  const saveAllStatus = page.querySelector('#quiz-editor-save-all-status')
  let savedValues = null
  let saving = false
  let savingAll = false
  let exporting = false
  let exportFormat = null
  let questionEditor = null

  function quizIsDirty() {
    return savedValues !== null && (nameInput.value !== savedValues.name
      || descriptionInput.value !== savedValues.description)
  }

  function updateSaveAllButton() {
    const dirty = quizIsDirty() || Boolean(questionEditor?.hasChanges())
    const busy = savingAll || saving || exporting || Boolean(questionEditor?.isSaving())
    const ready = savedValues !== null && Boolean(questionEditor?.isReady())
    saveAll.disabled = busy || !ready || !dirty
    saveAll.textContent = savingAll ? 'Saving all…' : dirty ? 'Save all' : 'Saved'
    exportButton.disabled = busy || !ready
    exportZipButton.disabled = busy || !ready
    exportButton.textContent = exporting && exportFormat === 'json' ? 'Exporting…' : 'Export JSON'
    exportZipButton.textContent = exporting && exportFormat === 'zip' ? 'Exporting…' : 'Export ZIP'
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

  exportButton.addEventListener('click', async () => {
    if (exportButton.disabled) return
    if (quizIsDirty() || questionEditor.hasChanges()) {
      setStatus(saveAllStatus, 'Save all changes before exporting.', true)
      return
    }
    exporting = true
    exportFormat = 'json'
    updateSaveAllButton()
    setStatus(saveAllStatus, '')
    try {
      const [quizResult, questionsResult, imagesResult] = await Promise.all([
        requestJson('GET', `/api/quiz/quizzes/${quizId}`),
        requestJson('GET', `/api/quiz/quizzes/${quizId}/questions`),
        requestJson('GET', '/api/quiz/images'),
      ])
      if (!app.contains(form)) return
      const [quizResponse, quiz] = quizResult
      const [questionsResponse, questionsPayload] = questionsResult
      const [imagesResponse, imagesPayload] = imagesResult
      if (!quizResponse.ok || !questionsResponse.ok || !imagesResponse.ok
        || !Array.isArray(questionsPayload?.questions) || !Array.isArray(imagesPayload?.images)) {
        setStatus(saveAllStatus, 'Could not export this quiz. Please try again.', true)
        return
      }
      const imageIds = new Set()
      function collectImageIds(value) {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (key === 'image_id' || key.endsWith('_image_id')) {
            imageIds.add(child)
          } else {
            collectImageIds(child)
          }
        }
      }
      for (const { config } of questionsPayload.questions) collectImageIds(config)
      const images = []
      const imageNames = new Map(imagesPayload.images.map((image) => [image.id, image.name]))
      for (const id of imageIds) {
        const name = imageNames.get(id)
        if (typeof name !== 'string') throw new Error('Could not export image name')
        const response = await fetch(`/api/quiz/images/${id}`)
        if (!response.ok) throw new Error('Could not export image')
        const bytes = new Uint8Array(await response.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
        }
        images.push({ id, name, data: btoa(binary) })
      }
      const data = {
        format: 'softerr-quiz',
        version: 1,
        name: quiz.name,
        description: quiz.description,
        questions: questionsPayload.questions.map(({ template, prompt, config }) => ({
          template, prompt, config,
        })),
        images,
      }
      const filename = quiz.name.toLowerCase().normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '').slice(0, 64) || 'quiz'
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${filename}.json`
      document.body.append(link)
      try {
        link.click()
      } finally {
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch {
      if (app.contains(form)) setStatus(saveAllStatus, 'Could not export this quiz. Please try again.', true)
    } finally {
      exporting = false
      exportFormat = null
      updateSaveAllButton()
    }
  })

  exportZipButton.addEventListener('click', async () => {
    if (exportZipButton.disabled) return
    if (quizIsDirty() || questionEditor.hasChanges()) {
      setStatus(saveAllStatus, 'Save all changes before exporting.', true)
      return
    }
    exporting = true
    exportFormat = 'zip'
    updateSaveAllButton()
    setStatus(saveAllStatus, '')
    try {
      const response = await fetch(`/api/quiz/quizzes/${quizId}/export.zip`)
      if (!app.contains(form)) return
      if (!response.ok) {
        setStatus(saveAllStatus, responseError(response, await response.json().catch(() => null)), true)
        return
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `quiz-${quizId}.zip`
      document.body.append(link)
      try {
        link.click()
      } finally {
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch {
      if (app.contains(form)) setStatus(saveAllStatus, 'Could not export this quiz. Please try again.', true)
    } finally {
      exporting = false
      exportFormat = null
      updateSaveAllButton()
    }
  })
}
