import { moveDownIcon, moveUpIcon, removeIcon } from './icons.js'
import { mediaImageUrl } from '@softerr/shared/media-client.js'
import { removeEmptyRowOnBackspace } from './field-navigation.js'

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

  const rows = document.createElement('div')
  rows.className = 'diagram-editor-rows'
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'auth-button auth-button-secondary'
  add.textContent = 'Add label'
  let selected = null
  let shownImageId = null

  function toggleSelection(row) {
    selected = selected === row ? null : row
    render()
  }

  function render() {
    const all = [...rows.children]
    add.disabled = all.length >= MAX_LABELS
    markers.replaceChildren()
    all.forEach((row, index) => {
      const active = row === selected
      row.classList.toggle('is-selected', active)
      row.querySelector('[data-select-point]').textContent = active ? 'Selected' : 'Place point'
      row.querySelector('[data-select-point]').setAttribute('aria-pressed', String(active))
      row.querySelector('[data-label-number]').textContent = `${index + 1}.`
      row.querySelector('[data-diagram-label]').setAttribute('aria-label', `Diagram label ${index + 1}`)
      row.querySelector('[data-move-up]').disabled = index === 0
      row.querySelector('[data-move-down]').disabled = index === all.length - 1
      row.querySelector('[data-remove-label]').disabled = all.length <= 2
      const x = Number(row.querySelector('[data-point-x]').value)
      const y = Number(row.querySelector('[data-point-y]').value)
      if (!row.querySelector('[data-point-x]').value || !row.querySelector('[data-point-y]').value) {
        row.querySelector('[data-point-status]').textContent = 'Point not placed'
        row.querySelector('[data-point-status]').hidden = false
        return
      }
      row.querySelector('[data-point-status]').textContent = ''
      row.querySelector('[data-point-status]').hidden = true
      const marker = document.createElement('button')
      marker.type = 'button'
      marker.className = 'diagram-editor-marker'
      marker.classList.toggle('is-selected', active)
      marker.style.left = `${x}%`
      marker.style.top = `${y}%`
      marker.textContent = String(index + 1)
      marker.title = row.querySelector('[data-diagram-label]').value.trim() || `Point ${index + 1}`
      marker.setAttribute('aria-label', `${active ? 'Unselect' : 'Select'} point ${index + 1}`)
      marker.addEventListener('click', () => toggleSelection(row))
      markers.append(marker)
    })
  }

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
    select.dataset.selectPoint = ''
    select.addEventListener('click', () => toggleSelection(row))
    const status = document.createElement('span')
    status.className = 'diagram-editor-point-status'
    status.dataset.pointStatus = ''
    const placement = document.createElement('div')
    placement.className = 'diagram-editor-placement'
    placement.append(select, status)
    const actions = document.createElement('div')
    actions.className = 'question-row-actions'
    for (const [direction, icon] of [['up', moveUpIcon], ['down', moveDownIcon]]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'icon-action'
      button.dataset[direction === 'up' ? 'moveUp' : 'moveDown'] = ''
      button.innerHTML = icon
      button.setAttribute('aria-label', `Move label ${direction}`)
      button.addEventListener('click', () => {
        const sibling = direction === 'up' ? row.previousElementSibling : row.nextElementSibling
        if (!sibling) return
        rows.insertBefore(row, direction === 'up' ? sibling : sibling.nextElementSibling)
        render()
        form.dispatchEvent(new Event('input'))
      })
      actions.append(button)
    }
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
  add.addEventListener('click', () => {
    if (rows.children.length >= MAX_LABELS) return
    selected = addRow()
    render()
    form.dispatchEvent(new Event('input'))
    selected.querySelector('[data-diagram-label]').focus()
  })
  const initial = Array.isArray(config.labels) && config.labels.length ? config.labels : [{}, {}]
  initial.forEach(addRow)
  fields.append(help, imageField, canvas, empty, rows, add)
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
    labels: [...fields.querySelectorAll('.diagram-editor-row')].map((row) => {
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
