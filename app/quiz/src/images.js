import { imageIcon, noImageIcon } from '@softerr/shared/icons.js'
import { mediaThumbnailUrl } from '@softerr/shared/media-client.js'
import { createMediaPicker } from '@softerr/shared/media-picker.js'

const thumbnailUrl = mediaThumbnailUrl

export function mountImageLibrary(section, { requestJson, responseError, setStatus }) {
  const pickers = new Set()
  let imageNames = new Map()
  const mediaPicker = createMediaPicker(section, {
    requestJson, responseError, setStatus,
    onImages(images) {
      imageNames = new Map(images.map((image) => [image.id, image.name]))
      for (const picker of pickers) if (picker.isConnected) updatePicker(picker)
    },
    onDelete(id) {
      for (const picker of pickers) {
        if (picker.isConnected && Number(picker.querySelector('[data-image-id]').value) === id) {
          setImage(picker, null)
        }
      }
    },
  })

  function updatePicker(picker) {
    const id = Number(picker.querySelector('[data-image-id]').value)
    const button = picker.querySelector('[data-choose-image]')
    const preview = button.querySelector('img')
    const icon = button.querySelector('svg')
    const missing = button.querySelector('[data-missing-image]')
    const label = picker.dataset.imageLabel
    const name = imageNames.get(id)
    preview.hidden = !id
    missing.hidden = true
    icon.toggleAttribute('hidden', Boolean(id))
    if (id) preview.src = thumbnailUrl(id)
    else preview.removeAttribute('src')
    button.setAttribute('aria-label', `${id ? 'Change' : 'Choose'} ${label.toLowerCase()}`)
    button.title = name || `${id ? 'Change' : 'Choose'} ${label.toLowerCase()}`
  }

  function setImage(picker, id) {
    const field = picker.querySelector('[data-image-id]')
    if (field.value === String(id || '')) return
    field.value = id ? String(id) : ''
    updatePicker(picker)
    picker.closest('form')?.dispatchEvent(new Event('input'))
  }

  function createPicker(label, id = null) {
    const picker = document.createElement('div')
    picker.className = 'image-picker'
    picker.dataset.imageLabel = label
    const preview = document.createElement('img')
    preview.alt = ''
    preview.loading = 'lazy'
    const missing = document.createElement('span')
    missing.dataset.missingImage = ''
    missing.hidden = true
    missing.innerHTML = noImageIcon
    const field = document.createElement('input')
    field.type = 'hidden'
    field.dataset.imageId = ''
    field.value = id ? String(id) : ''
    const choose = document.createElement('button')
    choose.type = 'button'
    choose.className = 'image-picker-button'
    choose.dataset.chooseImage = ''
    choose.innerHTML = imageIcon
    choose.append(missing, preview)
    preview.addEventListener('error', () => {
      preview.hidden = true
      choose.querySelector('svg').hidden = true
      missing.hidden = false
      choose.title = 'This image was deleted. Choose a replacement.'
      choose.setAttribute('aria-label', 'Missing image. Choose a replacement.')
    })
    choose.addEventListener('click', () => {
      mediaPicker.openSingle((chosenId) => {
        if (chosenId !== undefined && picker.isConnected) setImage(picker, chosenId)
      }, Number(field.value) || null)
    })
    picker.append(field, choose)
    pickers.add(picker)
    updatePicker(picker)
    return picker
  }

  return { createPicker, setImage, chooseMany: mediaPicker.openMany }
}
