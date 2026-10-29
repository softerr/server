import { addImagesIcon, deleteIcon, imageIcon, moveDownIcon, moveUpIcon, removeIcon, swapSidesIcon } from './icons.js'
import { mountImageLibrary } from './images.js'

const questionTypes = {
  multiple_choice: 'Multiple choice',
  one_choice: 'One choice',
  number: 'Number',
  short_answer: 'Short answer',
  open: 'Open',
  true_false: 'True/false',
  yes_no: 'Yes/no',
  show_answer: 'Show answer',
  no_answer: 'No answer',
  match: 'Match',
  ordering: 'Ordering',
  fill_blanks: 'Fill in the blanks',
  categorize: 'Categorize',
}

const templateHints = {
  multiple_choice: 'Select several answers',
  one_choice: 'Select one answer',
  number: 'Enter a number',
  short_answer: 'Enter a short answer',
  open: 'Write a free response',
  true_false: 'Choose true or false',
  yes_no: 'Choose yes or no',
  show_answer: 'Reveal the answer',
  no_answer: 'Question only',
  match: 'Match terms and definitions',
  ordering: 'Put items in sequence',
  fill_blanks: 'Complete missing words',
  categorize: 'Sort items into groups',
}

function templateIcon(content) {
  return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`
}

const templateIcons = {
  multiple_choice: templateIcon('<rect x="9" y="12" width="10" height="10" rx="1"/><path d="m11 17 3 3 6-7M27 17h27"/><rect x="9" y="27" width="10" height="10" rx="1"/><path d="M27 32h27"/><rect x="9" y="42" width="10" height="10" rx="1"/><path d="m11 47 3 3 6-7M27 47h27"/>'),
  one_choice: templateIcon('<circle cx="14" cy="17" r="5"/><path d="M27 17h27"/><circle cx="14" cy="32" r="5"/><circle cx="14" cy="32" r="2" fill="currentColor" stroke="none"/><path d="M27 32h27"/><circle cx="14" cy="47" r="5"/><path d="M27 47h27"/>'),
  number: templateIcon('<path d="M22 11 15 53M43 11l-7 42M10 26h46M7 39h46"/>'),
  short_answer: templateIcon('<path d="M9 48h46M10 34h25M37 43l14-14 4 4-14 14-6 2 2-6Z"/>'),
  open: templateIcon('<path d="M10 16h43M10 27h38M10 38h30M37 50l12-12 4 4-12 12-6 2 2-6Z"/>'),
  true_false: templateIcon('<rect x="8" y="15" width="48" height="34" rx="5"/><path d="M32 15v34"/><text x="20" y="38" fill="currentColor" stroke="none" font-size="17" font-weight="700" text-anchor="middle">T</text><text x="44" y="38" fill="currentColor" stroke="none" font-size="17" font-weight="700" text-anchor="middle">F</text>'),
  yes_no: templateIcon('<rect x="8" y="15" width="48" height="34" rx="5"/><path d="M32 15v34"/><text x="20" y="38" fill="currentColor" stroke="none" font-size="17" font-weight="700" text-anchor="middle">Y</text><text x="44" y="38" fill="currentColor" stroke="none" font-size="17" font-weight="700" text-anchor="middle">N</text>'),
  show_answer: templateIcon('<path d="M7 32s9-13 25-13 25 13 25 13-9 13-25 13S7 32 7 32Z"/><circle cx="32" cy="32" r="6"/>'),
  no_answer: templateIcon('<path d="M25 24a8 8 0 1 1 12 7c-4 2-5 4-5 8"/><circle cx="32" cy="49" r="2" fill="currentColor" stroke="none"/>'),
  match: templateIcon('<rect x="7" y="12" width="14" height="14" rx="2"/><rect x="43" y="12" width="14" height="14" rx="2"/><rect x="7" y="38" width="14" height="14" rx="2"/><rect x="43" y="38" width="14" height="14" rx="2"/><path d="M21 19h22M21 45h22"/>'),
  ordering: templateIcon('<path d="M15 15h38M15 31h38M15 47h38M8 11v8M8 27v8M8 43v8"/>'),
  fill_blanks: templateIcon('<path d="M8 17h16M40 17h16M25 21h14M8 43h12M44 43h12M21 47h22"/>'),
  categorize: templateIcon('<rect x="7" y="9" width="21" height="46" rx="2"/><rect x="36" y="9" width="21" height="46" rx="2"/><path d="M12 20h11M12 29h11M41 20h11M41 29h11M41 38h11"/>'),
}

let nextCorrectGroup = 0

function textField(labelText, value = '', maxLength = 150) {
  const label = document.createElement('label')
  label.className = 'field'
  const title = document.createElement('span')
  title.textContent = labelText
  const input = document.createElement('input')
  input.type = 'text'
  input.maxLength = maxLength
  input.required = true
  input.value = value
  label.append(title, input)
  return { label, input }
}

function longField(labelText, value = '', required = true) {
  const label = document.createElement('label')
  label.className = 'field'
  const title = document.createElement('span')
  title.textContent = labelText
  const textarea = document.createElement('textarea')
  textarea.rows = 4
  textarea.maxLength = 1000
  textarea.required = required
  textarea.value = value
  label.append(title, textarea)
  return { label, input: textarea }
}

function rowActions(row, rows, onUpdate) {
  const actions = document.createElement('div')
  actions.className = 'question-row-actions'
  for (const [direction, icon] of [['up', moveUpIcon], ['down', moveDownIcon]]) {
    const move = document.createElement('button')
    move.type = 'button'
    move.className = 'icon-action'
    move.dataset.moveRow = direction
    move.innerHTML = icon
    move.addEventListener('click', () => {
      const sibling = direction === 'up' ? row.previousElementSibling : row.nextElementSibling
      if (!sibling) return
      rows.insertBefore(row, direction === 'up' ? sibling : sibling.nextElementSibling)
      onUpdate()
      move.focus()
    })
    actions.append(move)
  }
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'icon-action'
  remove.dataset.removeRow = ''
  remove.innerHTML = removeIcon
  remove.addEventListener('click', () => {
    row.remove()
    onUpdate()
  })
  actions.append(remove)
  return actions
}

function updateRowActions(rows, itemName, minimum) {
  const count = rows.children.length
  ;[...rows.children].forEach((row, index) => {
    const remove = row.querySelector('[data-remove-row]')
    const removeLabel = `Remove ${itemName} ${index + 1}`
    remove.disabled = count <= minimum
    remove.setAttribute('aria-label', removeLabel)
    remove.title = removeLabel
    for (const [direction, disabled] of [['up', index === 0], ['down', index === count - 1]]) {
      const move = row.querySelector(`[data-move-row="${direction}"]`)
      const label = `Move ${itemName} ${index + 1} ${direction}`
      move.disabled = disabled
      move.setAttribute('aria-label', label)
      move.title = label
    }
  })
}

function iconButton(button, label, icon) {
  button.className = 'icon-action question-config-icon-action'
  button.innerHTML = icon
  button.setAttribute('aria-label', label)
  button.title = label
  return button
}

function renderConfig(form, template, config = {}, imageLibrary) {
  const fields = form.querySelector('[data-config-fields]')
  const answerImage = form.querySelector('[data-answer-image]')
  form.querySelector('[data-card-status]').before(answerImage)
  fields.replaceChildren()
  answerImage.hidden = true
  function addAnswerField(control) {
    const row = document.createElement('div')
    row.className = 'question-image-field'
    answerImage.hidden = false
    row.append(control, answerImage)
    fields.append(row)
  }
  function addFromImages(label, addImages) {
    const button = document.createElement('button')
    button.type = 'button'
    iconButton(button, label, addImagesIcon)
    button.addEventListener('click', () => imageLibrary.chooseMany((ids) => {
      if (!form.isConnected) return
      if (addImages(ids) !== false) form.dispatchEvent(new Event('input'))
    }))
    return button
  }
  function fillImageRows(rows, ids, textSelector, pickerSelector, append) {
    const empty = [...rows.children].filter((row) =>
      !row.querySelector(textSelector)?.value.trim()
      && !row.querySelector(`${pickerSelector} [data-image-id]`)?.value)
    for (const id of ids) {
      const row = empty.shift()
      if (row) imageLibrary.setImage(row.querySelector(pickerSelector), id)
      else append(id)
    }
  }
  function imageRowPlaceholder(label, createRow, inputSelector, pickerSelector, maxLength = 150, showLabel = false) {
    const placeholder = document.createElement('div')
    placeholder.className = 'question-row-placeholder'
    const field = textField(label, '', maxLength)
    if (!showLabel) field.label.classList.add('compact-field')
    field.input.required = false
    if (!showLabel) field.input.placeholder = label
    field.input.setAttribute('aria-label', `Add ${label.toLowerCase()}`)
    field.input.addEventListener('focus', () => {
      const row = createRow()
      if (!row) { field.input.blur(); return }
      form.dispatchEvent(new Event('input'))
      row.querySelector(inputSelector).focus()
    })
    const imageButton = document.createElement('button')
    imageButton.type = 'button'
    imageButton.className = 'image-picker-button'
    imageButton.innerHTML = imageIcon
    imageButton.setAttribute('aria-label', `Add ${label.toLowerCase()} with image`)
    imageButton.title = `Add ${label.toLowerCase()} with image`
    imageButton.addEventListener('click', () => {
      const row = createRow()
      if (!row) return
      form.dispatchEvent(new Event('input'))
      row.querySelector(`${pickerSelector} [data-choose-image]`).click()
    })
    const body = document.createElement('div')
    body.className = 'question-image-field'
    body.append(field.label, imageButton)
    placeholder.append(body)
    return placeholder
  }
  if (template === 'multiple_choice' || template === 'one_choice' || template === 'match') {
    const heading = document.createElement('div')
    heading.className = `question-config-heading ${template === 'match' ? 'is-match' : 'is-choice'}`
    for (const title of template === 'match' ? ['Keyword', 'Definition'] : ['Answer options', 'Correct']) {
      const label = document.createElement('span')
      label.textContent = title
      heading.append(label)
    }
    const rows = document.createElement('div')
    rows.className = 'question-config-rows'
    const actions = document.createElement('div')
    actions.className = 'question-config-actions'
    const addImages = addFromImages(template === 'match' ? 'Add pairs from images' : 'Add options from images',
      (ids) => fillImageRows(rows, ids,
        template === 'match' ? '[data-keyword]' : '[data-option-text]',
        template === 'match' ? '[data-keyword-image]' : '.option-image-picker',
        (id) => addRow(template === 'match' ? { keyword_image_id: id } : { image_id: id })))
    if (template === 'match') {
      actions.classList.add('is-match')
    }
    actions.append(addImages)
    if (template === 'match') {
      const swap = document.createElement('button')
      swap.type = 'button'
      iconButton(swap, 'Swap keywords and definitions', swapSidesIcon)
      swap.classList.add('question-swap-button')
      swap.addEventListener('click', () => {
        for (const row of rows.children) {
          const keyword = row.querySelector('[data-keyword]')
          const definition = row.querySelector('[data-definition]')
          ;[keyword.value, definition.value] = [definition.value, keyword.value]
          const keywordPicker = row.querySelector('[data-keyword-image]')
          const definitionPicker = row.querySelector('[data-definition-image]')
          const keywordId = Number(keywordPicker.querySelector('[data-image-id]').value)
          const definitionId = Number(definitionPicker.querySelector('[data-image-id]').value)
          imageLibrary.setImage(keywordPicker, definitionId)
          imageLibrary.setImage(definitionPicker, keywordId)
        }
        form.dispatchEvent(new Event('input'))
      })
      actions.append(swap)
    }
    function updateButtons() {
      updateRowActions(rows, template === 'match' ? 'pair' : 'option', 2)
      ;[...rows.children].forEach((row, index) => {
        const option = row.querySelector('[data-option-text]')
        if (option) option.setAttribute('aria-label', `Answer option ${index + 1}`)
        const keyword = row.querySelector('[data-keyword]')
        if (keyword) keyword.setAttribute('aria-label', `Keyword ${index + 1}`)
        const definition = row.querySelector('[data-definition]')
        if (definition) definition.setAttribute('aria-label', `Definition ${index + 1}`)
        const correct = row.querySelector('[data-correct]')
        if (correct) correct.setAttribute('aria-label', `Correct option ${index + 1}`)
      })
    }
    function addRow(value = {}) {
      const row = document.createElement('div')
      row.className = `question-config-row ${template === 'match' ? 'is-match' : 'is-choice'}`
      if (template === 'match') {
        const keyword = textField('Keyword', value.keyword)
        const definition = textField('Definition', value.definition)
        keyword.input.required = false
        definition.input.required = false
        keyword.label.classList.add('compact-field')
        definition.label.classList.add('compact-field')
        keyword.input.dataset.keyword = ''
        definition.input.dataset.definition = ''
        const keywordSide = document.createElement('div')
        keywordSide.className = 'question-match-side'
        const keywordImage = imageLibrary.createPicker('Keyword image', value.keyword_image_id)
        keywordImage.dataset.keywordImage = ''
        keywordImage.classList.add('inline-image-picker')
        keywordSide.append(keyword.label, keywordImage)
        const definitionSide = document.createElement('div')
        definitionSide.className = 'question-match-side'
        const definitionImage = imageLibrary.createPicker('Definition image', value.definition_image_id)
        definitionImage.dataset.definitionImage = ''
        definitionImage.classList.add('inline-image-picker')
        definitionSide.append(definition.label, definitionImage)
        row.append(keywordSide, definitionSide)
      } else {
        const text = textField('Answer option', value.text)
        text.input.required = false
        text.label.classList.add('compact-field')
        text.input.dataset.optionText = ''
        const correct = document.createElement('label')
        correct.className = 'question-correct'
        const input = document.createElement('input')
        input.type = template === 'one_choice' ? 'radio' : 'checkbox'
        input.name = form.dataset.correctGroup
        input.checked = Boolean(value.correct)
        input.dataset.correct = ''
        correct.append(input)
        const image = imageLibrary.createPicker('Option image', value.image_id)
        image.classList.add('option-image-picker')
        row.append(text.label, image, correct)
      }
      row.append(rowActions(row, rows, () => {
        updateButtons()
        form.dispatchEvent(new Event('input'))
      }))
      rows.append(row)
      updateButtons()
      return row
    }
    const initial = template === 'match' ? config.pairs : config.options
    const initialRows = Array.isArray(initial) && initial.length ? initial : [{}, {}]
    initialRows.forEach(addRow)
    if (template === 'match') {
      const placeholder = document.createElement('div')
      placeholder.className = 'question-pair-placeholder'
      for (const [side, label] of [['keyword', 'Keyword'], ['definition', 'Definition']]) {
        const field = textField(label)
        field.label.classList.add('compact-field')
        field.input.required = false
        field.input.placeholder = label
        field.input.setAttribute('aria-label', `Add pair: ${label.toLowerCase()}`)
        field.input.addEventListener('focus', () => {
          const row = addRow()
          form.dispatchEvent(new Event('input'))
          row.querySelector(`[data-${side}]`).focus()
        })
        const imageButton = document.createElement('button')
        imageButton.type = 'button'
        imageButton.className = 'image-picker-button'
        imageButton.innerHTML = imageIcon
        imageButton.setAttribute('aria-label', `Add pair with ${label.toLowerCase()} image`)
        imageButton.title = `Add pair with ${label.toLowerCase()} image`
        imageButton.addEventListener('click', () => {
          const row = addRow()
          form.dispatchEvent(new Event('input'))
          row.querySelector(`[data-${side}-image] [data-choose-image]`).click()
        })
        const control = document.createElement('div')
        control.className = 'question-match-side'
        control.append(field.label, imageButton)
        placeholder.append(control)
      }
      fields.append(heading, rows, placeholder, actions)
    } else {
      const placeholder = imageRowPlaceholder('Answer option', addRow,
        '[data-option-text]', '.option-image-picker')
      placeholder.classList.add('is-choice')
      const correct = document.createElement('label')
      correct.className = 'question-correct'
      const correctInput = document.createElement('input')
      correctInput.type = template === 'one_choice' ? 'radio' : 'checkbox'
      correctInput.setAttribute('aria-label', 'Add correct option')
      correctInput.addEventListener('click', () => {
        const row = addRow()
        row.querySelector('[data-correct]').checked = true
        correctInput.checked = false
        form.dispatchEvent(new Event('input'))
      })
      correct.append(correctInput)
      placeholder.append(correct)
      fields.append(heading, rows, placeholder, actions)
    }
    return
  }

  if (template === 'ordering') {
    const help = document.createElement('p')
    help.className = 'question-template-help'
    help.textContent = 'Enter items in the correct order. They can be shuffled when the quiz is taken.'
    const rows = document.createElement('div')
    rows.className = 'question-config-rows'
    function update() {
      updateRowActions(rows, 'item', 2)
      ;[...rows.children].forEach((row, index) => {
        row.querySelector('[data-order-item]').setAttribute('aria-label', `Item ${index + 1} in correct order`)
      })
    }
    function addItem(value = {}) {
      const row = document.createElement('div')
      row.className = 'question-config-row is-text-list'
      const field = textField('Item', value.text ?? '')
      field.input.required = false
      field.label.classList.add('compact-field')
      field.input.dataset.orderItem = ''
      const body = document.createElement('div')
      body.className = 'question-image-field'
      const image = imageLibrary.createPicker('Item image', value.image_id)
      image.classList.add('inline-image-picker')
      body.append(field.label, image)
      row.append(body, rowActions(row, rows, () => {
        update()
        form.dispatchEvent(new Event('input'))
      }))
      rows.append(row)
      update()
      return row
    }
    const initial = Array.isArray(config.items) && config.items.length ? config.items : [{}, {}]
    initial.forEach(addItem)
    const actions = document.createElement('div')
    actions.className = 'question-config-actions'
    actions.append(addFromImages('Add items from images', (ids) =>
      fillImageRows(rows, ids, '[data-order-item]', '.inline-image-picker',
        (id) => addItem({ image_id: id }))))
    const placeholder = imageRowPlaceholder('Item', addItem, '[data-order-item]', '.inline-image-picker')
    placeholder.classList.add('is-text-list')
    fields.append(help, rows, placeholder, actions)
    return
  }

  if (template === 'fill_blanks') {
    const help = document.createElement('p')
    help.className = 'question-template-help'
    help.textContent = 'Place {{1}}, {{2}}, and so on in the question text. Each marker needs one answer.'
    const grid = document.createElement('div')
    grid.className = 'question-blank-rows'
    const rows = document.createElement('div')
    rows.className = 'question-blank-entries'
    grid.append(rows)
    const actions = document.createElement('div')
    actions.className = 'question-config-actions'
    const remove = document.createElement('button')
    remove.type = 'button'
    iconButton(remove, 'Remove last blank', removeIcon)
    let placeholder = null
    function update() {
      const count = rows.children.length
      remove.disabled = count <= 1
      if (placeholder) {
        const input = placeholder.querySelector('input')
        placeholder.querySelector('.field span').textContent = `Answer for {{${count + 1}}}`
        input.setAttribute('aria-label', `Add answer for blank ${count + 1}`)
      }
    }
    function addBlank(value = {}) {
      const field = textField(`Answer for {{${rows.children.length + 1}}}`, value.text ?? '')
      field.input.required = false
      field.input.dataset.blankAnswer = ''
      const body = document.createElement('div')
      body.className = 'question-image-field'
      const image = imageLibrary.createPicker('Blank answer image', value.image_id)
      image.classList.add('inline-image-picker')
      body.append(field.label, image)
      rows.append(body)
      update()
      return body
    }
    const initial = Array.isArray(config.answers) && config.answers.length ? config.answers : [{}]
    initial.forEach(addBlank)
    const prompt = form.querySelector('[data-prompt]')
    if (!Array.isArray(config.answers) && !prompt.value.includes('{{1}}')) {
      prompt.value += `${prompt.value ? ' ' : ''}{{1}}`
    }
    function createBlank() {
      const number = rows.children.length + 1
      const addition = `${prompt.value ? ' ' : ''}{{${number}}}`
      if (prompt.value.length + addition.length > prompt.maxLength) {
        const status = form.querySelector('[data-card-status]')
        status.textContent = 'The question is too long for another blank.'
        status.classList.add('error')
        return null
      }
      const row = addBlank()
      prompt.value += addition
      return row
    }
    placeholder = imageRowPlaceholder(`Answer for {{${rows.children.length + 1}}}`, createBlank,
      '[data-blank-answer]', '.inline-image-picker', 150, true)
    placeholder.classList.add('is-blank')
    grid.append(placeholder)
    actions.append(addFromImages('Add blanks from images', (ids) => {
      const empty = [...rows.children].filter((row) =>
        !row.querySelector('[data-blank-answer]').value.trim() && !row.querySelector('[data-image-id]').value)
      const markers = ids.slice(empty.length).map((_, index) => `{{${rows.children.length + index + 1}}}`).join(' ')
      const addition = markers ? `${prompt.value ? ' ' : ''}${markers}` : ''
      if (prompt.value.length + addition.length > prompt.maxLength) {
        const status = form.querySelector('[data-card-status]')
        status.textContent = 'The question is too long for that many blanks.'
        status.classList.add('error')
        return false
      }
      fillImageRows(rows, ids, '[data-blank-answer]', '.inline-image-picker',
        (id) => addBlank({ image_id: id }))
      if (markers) prompt.value += addition
    }), remove)
    remove.addEventListener('click', () => {
      const number = rows.children.length
      if (number <= 1) return
      rows.lastElementChild.remove()
      prompt.value = prompt.value.replace(`{{${number}}}`, '')
      update()
      form.dispatchEvent(new Event('input'))
    })
    fields.append(help, grid, actions)
    return
  }

  if (template === 'categorize') {
    const help = document.createElement('p')
    help.className = 'question-template-help'
    help.textContent = 'Put each item in its correct category. Category names and items must be distinct.'
    const categories = document.createElement('div')
    categories.className = 'question-categories'
    function update() {
      updateRowActions(categories, 'category', 2)
      ;[...categories.children].forEach((category, categoryIndex) => {
        const items = category.querySelector('[data-category-items]')
        category.querySelector('[data-category-title]').textContent = `Category ${categoryIndex + 1}`
        category.querySelector('[data-category-name]').setAttribute('aria-label', `Category ${categoryIndex + 1} name`)
        updateRowActions(items, `category ${categoryIndex + 1} item`, 1)
        ;[...items.children].forEach((row, itemIndex) => {
          row.querySelector('[data-category-item]').setAttribute('aria-label',
            `Item ${itemIndex + 1} in category ${categoryIndex + 1}`)
        })
      })
    }
    function changed() {
      update()
      form.dispatchEvent(new Event('input'))
    }
    function addCategory(value = {}) {
      const category = document.createElement('div')
      category.className = 'question-category'
      const heading = document.createElement('div')
      heading.className = 'question-category-heading'
      const title = document.createElement('h4')
      title.dataset.categoryTitle = ''
      heading.append(title, rowActions(category, categories, changed))
      const name = textField('Category name', value.name, 100)
      name.input.required = false
      name.input.dataset.categoryName = ''
      const nameBody = document.createElement('div')
      nameBody.className = 'question-image-field'
      const nameImage = imageLibrary.createPicker('Category image', value.name_image_id)
      nameImage.dataset.categoryNameImage = ''
      nameImage.classList.add('inline-image-picker')
      nameBody.append(name.label, nameImage)
      const items = document.createElement('div')
      items.className = 'question-config-rows'
      items.dataset.categoryItems = ''
      const itemsLabel = document.createElement('span')
      itemsLabel.className = 'question-category-items-label'
      itemsLabel.textContent = 'Items'
      function addItem(value = {}) {
        const row = document.createElement('div')
        row.className = 'question-config-row is-text-list'
        const field = textField('Item', value.text ?? '')
        field.input.required = false
        field.label.classList.add('compact-field')
        field.input.dataset.categoryItem = ''
        const body = document.createElement('div')
        body.className = 'question-image-field'
        const image = imageLibrary.createPicker('Category item image', value.image_id)
        image.classList.add('inline-image-picker')
        body.append(field.label, image)
        row.append(body, rowActions(row, items, changed))
        items.append(row)
        update()
        return row
      }
      const itemPlaceholder = imageRowPlaceholder('Item', addItem,
        '[data-category-item]', '.inline-image-picker')
      itemPlaceholder.classList.add('is-text-list')
      const itemActions = document.createElement('div')
      itemActions.className = 'question-config-actions'
      itemActions.append(addFromImages('Add items from images', (ids) => {
        if (category.isConnected) fillImageRows(items, ids, '[data-category-item]', '.inline-image-picker',
          (id) => addItem({ image_id: id }))
      }))
      category.append(heading, nameBody, itemsLabel, items, itemPlaceholder, itemActions)
      categories.append(category)
      const initialItems = Array.isArray(value.items) && value.items.length ? value.items : [{}]
      initialItems.forEach(addItem)
      update()
      return category
    }
    const initial = Array.isArray(config.categories) && config.categories.length
      ? config.categories : [{ items: [{}] }, { items: [{}] }]
    initial.forEach(addCategory)
    const actions = document.createElement('div')
    actions.className = 'question-config-actions'
    actions.append(addFromImages('Add categories from images', (ids) =>
      fillImageRows(categories, ids, '[data-category-name]', '[data-category-name-image]',
        (id) => addCategory({ name_image_id: id, items: [{}] }))))
    const placeholderCategory = document.createElement('div')
    placeholderCategory.className = 'question-category question-category-placeholder'
    const title = document.createElement('h4')
    title.textContent = 'New category'
    const placeholder = imageRowPlaceholder('Category name', addCategory,
      '[data-category-name]', '[data-category-name-image]', 100)
    placeholderCategory.append(title, placeholder)
    fields.append(help, categories, placeholderCategory, actions)
    return
  }

  if (template === 'true_false' || template === 'yes_no') {
    const field = document.createElement('label')
    field.className = 'field'
    const title = document.createElement('span')
    title.textContent = 'Correct answer'
    const select = document.createElement('select')
    select.dataset.booleanAnswer = ''
    select.required = true
    const labels = template === 'true_false' ? ['True', 'False'] : ['Yes', 'No']
    for (const [value, label] of [['', 'Choose an answer'], ['true', labels[0]], ['false', labels[1]]]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      select.append(option)
    }
    select.value = typeof config.answer === 'boolean' ? String(config.answer) : ''
    field.append(title, select)
    addAnswerField(field)
    return
  }
  if (template === 'number') {
    const field = textField('Correct number', config.answer ?? '', 64)
    field.input.inputMode = 'decimal'
    field.input.dataset.answer = ''
    addAnswerField(field.label)
  } else if (template === 'short_answer') {
    const field = textField('Correct answer', config.answer ?? '', 500)
    field.input.dataset.answer = ''
    addAnswerField(field.label)
  } else if (template === 'open' || template === 'show_answer') {
    const field = longField(
      template === 'open' ? 'Sample answer (optional)' : 'Answer to reveal',
      template === 'open' ? config.sample_answer ?? '' : config.answer ?? '',
      template !== 'open',
    )
    field.input.dataset.answer = ''
    addAnswerField(field.label)
  } else if (template === 'no_answer') {
    const help = document.createElement('p')
    help.className = 'question-template-help'
    help.textContent = 'This question has no answer field.'
    fields.append(help)
  }
}

function collectConfig(form, template) {
  const fields = form.querySelector('[data-config-fields]')
  const imageText = (container, selector) => {
    const text = container.querySelector(selector).value.trim()
    const id = container.querySelector('[data-image-id]').value
    return id ? { text, image_id: Number(id) } : { text }
  }
  let config
  if (template === 'multiple_choice' || template === 'one_choice') {
    config = { options: [...fields.querySelectorAll('.question-config-row')].map((row) => ({
      text: row.querySelector('[data-option-text]').value.trim(),
      correct: row.querySelector('[data-correct]').checked,
      ...(row.querySelector('.option-image-picker [data-image-id]').value
        ? { image_id: Number(row.querySelector('.option-image-picker [data-image-id]').value) } : {}),
    })) }
  } else if (template === 'match') {
    config = { pairs: [...fields.querySelectorAll('.question-config-row')].map((row) => ({
      keyword: row.querySelector('[data-keyword]').value.trim(),
      definition: row.querySelector('[data-definition]').value.trim(),
      ...(row.querySelector('[data-keyword-image] [data-image-id]').value
        ? { keyword_image_id: Number(row.querySelector('[data-keyword-image] [data-image-id]').value) } : {}),
      ...(row.querySelector('[data-definition-image] [data-image-id]').value
        ? { definition_image_id: Number(row.querySelector('[data-definition-image] [data-image-id]').value) } : {}),
    })) }
  } else if (template === 'ordering') {
    config = { items: [...fields.querySelectorAll('.question-config-row')].map((row) =>
      imageText(row, '[data-order-item]')) }
  } else if (template === 'fill_blanks') {
    config = { answers: [...fields.querySelectorAll('.question-blank-entries > *')].map((row) =>
      imageText(row, '[data-blank-answer]')) }
  } else if (template === 'categorize') {
    config = { categories: [...fields.querySelectorAll('.question-categories > .question-category')].map((category) => ({
      name: category.querySelector('[data-category-name]').value.trim(),
      ...(category.querySelector('[data-category-name-image] [data-image-id]').value
        ? { name_image_id: Number(category.querySelector('[data-category-name-image] [data-image-id]').value) } : {}),
      items: [...category.querySelectorAll('[data-category-items] > *')].map((row) =>
        imageText(row, '[data-category-item]')),
    })) }
  } else if (template === 'true_false' || template === 'yes_no') {
    const value = fields.querySelector('[data-boolean-answer]').value
    config = { answer: value === '' ? null : value === 'true' }
  } else if (template === 'open') {
    config = { sample_answer: fields.querySelector('[data-answer]').value.trim() }
  } else if (template === 'no_answer') {
    config = {}
  } else {
    config = { answer: fields.querySelector('[data-answer]').value.trim() }
  }
  const questionImage = form.querySelector('[data-question-image] [data-image-id]').value
  const answerImage = form.querySelector('[data-answer-image] [data-image-id]').value
  if (questionImage) config.image_id = Number(questionImage)
  if (answerImage && !form.querySelector('[data-answer-image]').hidden) {
    config.answer_image_id = Number(answerImage)
  }
  return config
}

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
