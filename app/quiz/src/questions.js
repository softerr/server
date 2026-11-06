import { deleteIcon, moveDownIcon, moveUpIcon } from './icons.js'
import { mountImageLibrary } from './images.js'
import { questionTypes, templateHints, templateIcons } from './question-templates.js'
import { renderConfig, collectConfig } from './question-config.js'

let nextCorrectGroup = 0

export function mountQuestionEditor(app, section, quizId, { currentUser, requestJson, responseError, setStatus, onChange = () => {} }) {
  section.innerHTML = `
    <div class="questions-heading">
      <h2>Questions</h2>
    </div>
    <p id="questions-status" class="form-status" role="status" aria-live="polite">Loading questions…</p>
    <ol id="question-list" class="question-list"></ol>
    <section id="question-template-picker" class="question-template-picker" aria-labelledby="question-template-title" hidden>
      <h3 id="question-template-title">Add a question</h3>
      <div id="question-template-grid" class="question-template-grid">
        ${Object.entries(questionTypes).map(([value, label]) => `
          <button class="question-template-tile" type="button" data-new-template="${value}" disabled>
            <span class="question-template-icon" aria-hidden="true">${templateIcons[value]}</span>
            <strong>${label}</strong><span class="question-template-hint">${templateHints[value]}</span>
          </button>
        `).join('')}
      </div>
    </section>
    <dialog id="delete-question-dialog" class="quiz-dialog" aria-labelledby="delete-question-title">
      <h2 id="delete-question-title">Delete question?</h2>
      <p>This question will be removed from the quiz.</p>
      <p id="delete-question-status" class="form-status" role="status" aria-live="polite"></p>
      <div class="dialog-actions">
        <button id="cancel-delete-question" class="auth-button auth-button-secondary" type="button">Cancel</button>
        <button id="confirm-delete-question" class="auth-button auth-button-primary" type="button">Delete</button>
      </div>
    </dialog>
  `

  const list = section.querySelector('#question-list')
  const listStatus = section.querySelector('#questions-status')
  const templatePicker = section.querySelector('#question-template-picker')
  const templateGrid = section.querySelector('#question-template-grid')
  const deleteDialog = section.querySelector('#delete-question-dialog')
  const deleteStatus = section.querySelector('#delete-question-status')
  const confirmDelete = section.querySelector('#confirm-delete-question')
  const imageLibrary = mountImageLibrary(section, { currentUser, requestJson, responseError, setStatus })
  const encoder = new TextEncoder()
  let questions = []
  let draftCard = null
  let deletingCard = null
  let reordering = false
  let loaded = false
  const cardControllers = new Map()

  function updateList() {
    templateGrid.querySelectorAll('[data-new-template]').forEach((button) => {
      button.disabled = reordering || draftCard !== null || questions.length >= 100
    })
    setStatus(listStatus, questions.length ? `${questions.length} questions` : 'No questions yet.')
    const cards = [...list.children]
    cards.forEach((card, index) => {
      card.querySelector('[data-card-title]').textContent = card === draftCard
        ? 'New question' : `Question ${index + 1}`
      const remove = card.querySelector('[data-delete-question]')
      remove.setAttribute('aria-label', `Delete question ${index + 1}`)
      remove.title = `Delete question ${index + 1}`
      remove.disabled = reordering
      for (const [direction, atEdge] of [['up', index === 0], ['down', index === questions.length - 1]]) {
        const move = card.querySelector(`[data-move-question="${direction}"]`)
        const label = `Move question ${index + 1} ${direction}`
        move.disabled = reordering || card === draftCard || atEdge
        move.setAttribute('aria-label', label)
        move.title = label
      }
    })
    onChange()
  }

  function createCard(initialQuestion = null, initialTemplate = 'multiple_choice') {
    const card = document.createElement('li')
    card.className = 'question-item'
    const form = document.createElement('form')
    form.className = 'question-card-form'
    form.dataset.correctGroup = `correct-option-${++nextCorrectGroup}`
    form.innerHTML = `
      <div class="question-card-heading">
        <h3 data-card-title></h3>
        <div class="question-card-heading-actions">
          <button class="icon-action" data-move-question="up" type="button">${moveUpIcon}</button>
          <button class="icon-action" data-move-question="down" type="button">${moveDownIcon}</button>
          <button class="icon-action" data-delete-question type="button" aria-label="Delete question" title="Delete question">${deleteIcon}</button>
        </div>
      </div>
      <label class="field">
        <span>Template</span>
        <select data-template required>
          ${Object.entries(questionTypes).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
        </select>
      </label>
      <div class="question-image-field">
        <label class="field">
          <span>Question</span>
          <textarea data-prompt rows="3" maxlength="500" required></textarea>
        </label>
        <div data-question-image></div>
      </div>
      <label class="field question-time-setting"><span>Time limit (seconds, optional)</span>
        <input data-time-limit type="number" min="1" max="86400" step="1" placeholder="No limit" />
      </label>
      <div class="question-config-fields" data-config-fields></div>
      <div data-answer-image></div>
      <p class="form-status" data-card-status role="status" aria-live="polite"></p>
      <div class="question-card-actions">
        <button class="auth-button auth-button-secondary" data-reset type="button">Reset</button>
        <button class="auth-button auth-button-secondary" data-cancel type="button">Cancel</button>
        <button class="auth-button auth-button-primary" data-save type="submit">Save question</button>
      </div>
    `
    card.append(form)
    const templateSelect = form.querySelector('[data-template]')
    const promptInput = form.querySelector('[data-prompt]')
    const status = form.querySelector('[data-card-status]')
    const saveButton = form.querySelector('[data-save]')
    const resetButton = form.querySelector('[data-reset]')
    const cancelButton = form.querySelector('[data-cancel]')
    const deleteButton = form.querySelector('[data-delete-question]')
    let savedQuestion = initialQuestion
    let savedSnapshot = null
    let saving = false

    function formSnapshot() {
      return JSON.stringify([...form.querySelectorAll('input, textarea, select')].map((control) => [
        control.value,
        control.type === 'checkbox' || control.type === 'radio' ? control.checked : null,
      ]))
    }

    function updateSaveButton() {
      if (saving) return
      const dirty = isDirty()
      saveButton.disabled = !dirty
      saveButton.textContent = dirty
        ? savedQuestion === null ? 'Add question' : 'Save question'
        : 'Saved'
      onChange()
    }

    function populate(question) {
      card.dataset.questionId = question ? String(question.id) : ''
      templateSelect.value = question?.template ?? initialTemplate
      promptInput.value = question?.prompt ?? ''
      form.querySelector('[data-time-limit]').value = question?.time_limit_seconds ?? ''
      form.querySelector('[data-question-image]').replaceChildren(
        imageLibrary.createPicker('Question image', question?.config?.image_id))
      form.querySelector('[data-answer-image]').replaceChildren(
        imageLibrary.createPicker('Answer image', question?.config?.answer_image_id))
      renderConfig(form, templateSelect.value, question?.config, imageLibrary)
      resetButton.hidden = !question
      cancelButton.hidden = Boolean(question)
      deleteButton.hidden = !question
      savedSnapshot = question ? formSnapshot() : null
      updateSaveButton()
    }
    populate(savedQuestion)

    templateSelect.addEventListener('change', () => {
      renderConfig(form, templateSelect.value, {}, imageLibrary)
    })
    function onEdit() {
      setStatus(status, '')
      updateSaveButton()
    }
    form.addEventListener('input', onEdit)
    form.addEventListener('change', onEdit)
    resetButton.addEventListener('click', () => {
      populate(savedQuestion)
      setStatus(status, '')
    })
    cancelButton.addEventListener('click', () => {
      card.remove()
      cardControllers.delete(card)
      draftCard = null
      updateList()
    })
    deleteButton.addEventListener('click', () => {
      deletingCard = card
      setStatus(deleteStatus, '')
      deleteDialog.showModal()
    })
    function currentQuestion() {
      if (!form.reportValidity()) {
        setStatus(status, 'Complete this question.', true)
        return null
      }
      const template = templateSelect.value
      const prompt = promptInput.value.trim()
      const config = collectConfig(form, template)
      if ((template === 'multiple_choice' || template === 'one_choice')
          && config.options.some((option) => !option.text && !option.image_id)) {
        setStatus(status, 'Each option needs text or an image.', true)
        return null
      }
      if (!prompt || encoder.encode(prompt).length > 500) {
        setStatus(status, 'Question must be 1 to 500 bytes.', true)
        return null
      }
      if ((template === 'multiple_choice' || template === 'one_choice')
          && !config.options.some((option) => option.correct)) {
        setStatus(status, 'Choose at least one correct answer.', true)
        return null
      }
      const timeLimit = form.querySelector('[data-time-limit]').value
      return { template, prompt, config, time_limit_seconds: timeLimit === '' ? null : Number(timeLimit) }
    }

    async function saveQuestion() {
      if (!isDirty()) return true
      if (saving || reordering) return false
      const questionFields = currentQuestion()
      if (questionFields === null) return false
      const { template, prompt, config, time_limit_seconds } = questionFields

      saving = true
      saveButton.disabled = true
      saveButton.textContent = 'Saving…'
      onChange()
      const controls = [...form.querySelectorAll('input, textarea, select, button')]
        .filter((control) => control !== saveButton)
      const disabledBefore = controls.map((control) => control.disabled)
      controls.forEach((control) => { control.disabled = true })
      setStatus(status, '')
      try {
        const path = `/api/quiz/quizzes/${quizId}/questions`
        const [response, question] = savedQuestion === null
          ? await requestJson('POST', path, { template, prompt, config, time_limit_seconds })
          : await requestJson('PATCH', `${path}/${savedQuestion.id}`, { template, prompt, config, time_limit_seconds })
        if (!app.contains(card)) return false
        if (!response.ok) {
          setStatus(status, responseError(response, question), true)
          return false
        }
        if (savedQuestion === null) {
          questions.push(question)
          draftCard = null
        } else {
          questions = questions.map((entry) => entry.id === savedQuestion.id ? question : entry)
        }
        savedQuestion = question
        populate(question)
        updateList()
        setStatus(status, '')
        return true
      } catch {
        if (app.contains(card)) setStatus(status, 'Could not save question. Please try again.', true)
        return false
      } finally {
        controls.forEach((control, index) => { control.disabled = disabledBefore[index] })
        saving = false
        if (app.contains(card)) updateSaveButton()
        if (app.contains(card)) updateList()
      }
    }
    function isDirty() {
      return savedQuestion === null || formSnapshot() !== savedSnapshot
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!saveButton.disabled) void saveQuestion()
    })
    cardControllers.set(card, { isDirty, isSaving: () => saving, save: saveQuestion,
      preview: () => {
        const fields = currentQuestion()
        return fields === null ? null : { ...fields, id: savedQuestion?.id ?? null }
      } })
    return card
  }

  requestJson('GET', `/api/quiz/quizzes/${quizId}/questions`).then(([response, payload]) => {
    if (!app.contains(section)) return
    if (!response.ok) {
      setStatus(listStatus, responseError(response, payload), true)
      return
    }
    questions = payload.questions
    questions.forEach((question) => list.append(createCard(question)))
    loaded = true
    templatePicker.hidden = false
    updateList()
  }).catch(() => {
    if (app.contains(section)) setStatus(listStatus, 'Could not load questions. Reload the page to try again.', true)
  })

  templateGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-new-template]')
    if (!button || button.disabled || !templateGrid.contains(button)) return
    draftCard = createCard(null, button.dataset.newTemplate)
    list.append(draftCard)
    updateList()
    draftCard.scrollIntoView({ behavior: 'smooth', block: 'start' })
    draftCard.querySelector('[data-prompt]').focus({ preventScroll: true })
  })

  list.addEventListener('click', async (event) => {
    const move = event.target.closest('[data-move-question]')
    if (!move || move.disabled || reordering || !list.contains(move)) return
    const card = move.closest('.question-item')
    const index = [...list.children].indexOf(card)
    const target = index + (move.dataset.moveQuestion === 'up' ? -1 : 1)
    if (index < 0 || target < 0 || target >= questions.length || card === draftCard) return
    const reordered = [...questions]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    reordering = true
    updateList()
    setStatus(listStatus, 'Saving question order…')
    let reorderError = ''
    try {
      const [response, payload] = await requestJson('PUT',
        `/api/quiz/quizzes/${quizId}/questions/order`,
        { question_ids: reordered.map((question) => question.id) })
      if (!app.contains(section)) return
      if (!response.ok) {
        reorderError = responseError(response, payload)
        return
      }
      questions = reordered
      const neighbor = list.children[target]
      list.insertBefore(card, target < index ? neighbor : neighbor.nextElementSibling)
      move.focus()
    } catch {
      reorderError = 'Could not reorder questions. Please try again.'
    } finally {
      reordering = false
      if (app.contains(section)) {
        updateList()
        if (reorderError) setStatus(listStatus, reorderError, true)
      }
    }
  })

  deleteDialog.addEventListener('cancel', (event) => {
    if (confirmDelete.disabled) event.preventDefault()
  })
  section.querySelector('#cancel-delete-question').addEventListener('click', () => {
    if (!confirmDelete.disabled) deleteDialog.close()
  })
  confirmDelete.addEventListener('click', async () => {
    if (confirmDelete.disabled || !deletingCard) return
    const card = deletingCard
    const questionId = questions.find((question) => String(question.id) === card.dataset.questionId)?.id
    if (!questionId) return
    confirmDelete.disabled = true
    setStatus(deleteStatus, 'Deleting question…')
    try {
      const [response, payload] = await requestJson('DELETE',
        `/api/quiz/quizzes/${quizId}/questions/${questionId}`)
      if (!app.contains(section)) return
      if (!response.ok) {
        setStatus(deleteStatus, responseError(response, payload), true)
        return
      }
      questions = questions.filter((question) => question.id !== questionId)
      card.remove()
      cardControllers.delete(card)
      deletingCard = null
      updateList()
      deleteDialog.close()
    } catch {
      if (app.contains(section)) setStatus(deleteStatus, 'Could not delete question. Please try again.', true)
    } finally {
      confirmDelete.disabled = false
    }
  })

  return {
    isReady: () => loaded,
    isSaving: () => reordering || [...cardControllers.values()].some((controller) => controller.isSaving()),
    hasChanges: () => [...cardControllers.values()].some((controller) => controller.isDirty()),
    previewQuestions() {
      if (!loaded || reordering || [...cardControllers.values()].some((controller) => controller.isSaving())) return null
      const snapshot = []
      for (const card of list.children) {
        const question = cardControllers.get(card)?.preview()
        if (!question) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return null
        }
        snapshot.push(question)
      }
      return snapshot
    },
    async saveChanges() {
      if (!loaded || reordering) return false
      for (const card of [...list.children]) {
        const controller = cardControllers.get(card)
        if (!controller?.isDirty()) continue
        if (!await controller.save()) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return false
        }
      }
      return true
    },
  }
}
