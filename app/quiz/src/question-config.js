import { addImagesIcon, imageIcon, moveDownIcon, moveUpIcon, removeIcon, swapSidesIcon } from './icons.js'

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

export function renderConfig(form, template, config = {}, imageLibrary) {
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

export function collectConfig(form, template) {
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

