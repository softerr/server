import { placePointIcon, removeIcon, selectedPointIcon } from './icons.js'
import { mediaImageUrl } from '@softerr/shared/media-client.js'
import { removeEmptyRowOnBackspace } from './field-navigation.js'
import { createRowReorderHandle } from './reorder-rows.js'

const MAX_LABELS = 30
const listeners = new WeakMap()

export function disposeDiagramConfig(form) {
  listeners.get(form)?.abort()
  listeners.delete(form)
}

export function renderDiagramConfig(fields, form, config, imageLibrary) {
  const help = document.createElement('p')
  help.className = 'question-template-help'
  help.textContent = 'Choose a diagram, then select a label and click the image to place its numbered point.'

  const imageField = document.createElement('div')
  imageField.className = 'diagram-editor-image-field'
  const imageTitle = document.createElement('strong')
  imageTitle.textContent = 'Diagram image'
  const imagePicker = imageLibrary.createPicker('Diagram image', config.diagram_image_id)
  imagePicker.dataset.diagramImage = ''
  imageField.append(imageTitle, imagePicker)

  const canvas = document.createElement('div')
  canvas.className = 'diagram-editor-canvas'
  const image = document.createElement('img')
  image.className = 'diagram-editor-image'
  image.alt = 'Diagram to label'
  image.draggable = false
  const markers = document.createElement('div')
  markers.className = 'diagram-editor-markers'
  canvas.append(image, markers)
  const empty = document.createElement('p')
  empty.className = 'diagram-editor-empty'
  empty.textContent = 'Choose an image to place label points.'

  const list = document.createElement('div')
  list.className = 'diagram-editor-list'
  const rows = document.createElement('div')
  rows.className = 'diagram-editor-rows'
  const placeholder = document.createElement('div')
  placeholder.className = 'diagram-editor-row is-placeholder'
  const placeholderNumber = document.createElement('strong')
  const placeholderLabel = document.createElement('label')
  placeholderLabel.className = 'field'
  const placeholderInput = document.createElement('input')
  placeholderInput.type = 'text'
  placeholderInput.maxLength = 150
  placeholderInput.placeholder = 'Add label'
  placeholderInput.setAttribute('aria-label', 'Add diagram label')
  placeholderLabel.append(placeholderInput)
  placeholder.append(placeholderNumber, placeholderLabel)
  list.append(rows, placeholder)
  let selected = null
  let shownImageId = null

  function toggleSelection(row) {
    selected = selected === row ? null : row
    render()
  }

  function render() {
    const all = [...rows.children]
    placeholderNumber.textContent = `${all.length + 1}.`
    placeholderInput.disabled = all.length >= MAX_LABELS
    markers.replaceChildren()
    all.forEach((row, index) => {
      const active = row === selected
      row.classList.toggle('is-selected', active)
      const select = row.querySelector('[data-select-point]')
      select.innerHTML = active ? selectedPointIcon : placePointIcon
      select.setAttribute('aria-pressed', String(active))
      row.querySelector('[data-label-number]').textContent = `${index + 1}.`
      row.querySelector('[data-diagram-label]').setAttribute('aria-label', `Diagram label ${index + 1}`)
      const handle = row.querySelector('[data-reorder-handle]')
      handle.disabled = all.length < 2
      handle.setAttribute('aria-label', `Reorder label ${index + 1}`)
      handle.title = 'Drag to reorder, or press Alt + Arrow up or down'
      row.querySelector('[data-remove-label]').disabled = all.length <= 2
      const xValue = row.querySelector('[data-point-x]').value
      const yValue = row.querySelector('[data-point-y]').value
      const placed = xValue !== '' && yValue !== ''
      const placementStatus = placed ? 'placed' : 'not placed'
      select.classList.toggle('is-point-placed', placed)
      select.setAttribute('aria-label', `${active ? 'Unselect' : 'Select'} label ${index + 1} for point placement; point ${placementStatus}`)
      select.title = `${active ? 'Unselect' : 'Select for'} point placement; point ${placementStatus}`
      if (!placed) return
      const marker = document.createElement('button')
      marker.type = 'button'
      marker.className = 'diagram-editor-marker'
      marker.classList.toggle('is-selected', active)
      marker.style.left = `${Number(xValue)}%`
      marker.style.top = `${Number(yValue)}%`
      marker.textContent = String(index + 1)
      marker.title = row.querySelector('[data-diagram-label]').value.trim() || `Point ${index + 1}`
      marker.setAttribute('aria-label', `${active ? 'Unselect' : 'Select'} point ${index + 1}`)
      marker.addEventListener('click', () => toggleSelection(row))
      markers.append(marker)
    })
  }

  placeholderInput.addEventListener('focus', () => {
    if (rows.children.length >= MAX_LABELS) { placeholderInput.blur(); return }
    selected = addRow()
    render()
    form.dispatchEvent(new Event('input'))
    selected.querySelector('[data-diagram-label]').focus()
  })

  function addRow(value = {}) {
    const row = document.createElement('div')
    row.className = 'diagram-editor-row'
    const number = document.createElement('strong')
    number.dataset.labelNumber = ''
    const label = document.createElement('label')
    label.className = 'field'
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = 150
    input.required = true
    input.value = value.text ?? ''
    input.dataset.diagramLabel = ''
    label.append(input)
    const x = document.createElement('input')
    x.type = 'hidden'
    x.dataset.pointX = ''
    x.value = value.x ?? ''
    const y = document.createElement('input')
    y.type = 'hidden'
    y.dataset.pointY = ''
    y.value = value.y ?? ''
    const select = document.createElement('button')
    select.type = 'button'
    select.className = 'icon-action'
    select.dataset.selectPoint = ''
    select.addEventListener('click', () => toggleSelection(row))
    const placement = document.createElement('div')
    placement.className = 'diagram-editor-placement'
    placement.append(select)
    const actions = document.createElement('div')
    actions.className = 'question-row-actions'
    actions.append(createRowReorderHandle(row, rows, () => {
      render()
      form.dispatchEvent(new Event('input'))
    }))
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'icon-action'
    remove.dataset.removeLabel = ''
    remove.innerHTML = removeIcon
    remove.setAttribute('aria-label', 'Remove label')
    remove.addEventListener('click', () => {
      if (rows.children.length <= 2) return
      if (selected === row) selected = row.nextElementSibling || row.previousElementSibling
      row.remove()
      render()
      form.dispatchEvent(new Event('input'))
    })
    actions.append(remove)
    row.append(number, label, x, y, placement, actions)
    rows.append(row)
    removeEmptyRowOnBackspace(input, row,
      { removeSelector: '[data-remove-label]', focusSelector: '[data-diagram-label]' })
    if (!selected) selected = row
    render()
    return row
  }

  image.addEventListener('click', (event) => {
    if (!selected) return
    const bounds = image.getBoundingClientRect()
    const x = Math.max(0, Math.min(100, Math.round((event.clientX - bounds.left) / bounds.width * 1000) / 10))
    const y = Math.max(0, Math.min(100, Math.round((event.clientY - bounds.top) / bounds.height * 1000) / 10))
    selected.querySelector('[data-point-x]').value = String(x)
    selected.querySelector('[data-point-y]').value = String(y)
    render()
    form.dispatchEvent(new Event('input'))
  })
  const controller = new AbortController()
  listeners.set(form, controller)
  form.addEventListener('input', () => {
    const id = Number(imagePicker.querySelector('[data-image-id]').value)
    if (id !== shownImageId) {
      shownImageId = id
      canvas.hidden = !id
      empty.hidden = Boolean(id)
      if (id) image.src = mediaImageUrl(id)
      else image.removeAttribute('src')
    }
    render()
  }, { signal: controller.signal })
  const initial = Array.isArray(config.labels) && config.labels.length ? config.labels : [{}, {}]
  initial.forEach(addRow)
  fields.append(help, imageField, canvas, empty, list)
  const id = Number(imagePicker.querySelector('[data-image-id]').value)
  shownImageId = id
  canvas.hidden = !id
  empty.hidden = Boolean(id)
  if (id) image.src = mediaImageUrl(id)
}

export function collectDiagramConfig(fields) {
  const id = Number(fields.querySelector('[data-diagram-image] [data-image-id]').value)
  return {
    ...(id ? { diagram_image_id: id } : {}),
    labels: [...fields.querySelectorAll('.diagram-editor-rows > .diagram-editor-row')].map((row) => {
      const x = row.querySelector('[data-point-x]').value
      const y = row.querySelector('[data-point-y]').value
      return {
        text: row.querySelector('[data-diagram-label]').value.trim(),
        x: x === '' ? null : Number(x),
        y: y === '' ? null : Number(y),
      }
    }),
  }
}
