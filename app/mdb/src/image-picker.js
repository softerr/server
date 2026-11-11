import { imageIcon, noImageIcon, uploadImageIcon } from '@softerr/shared/icons.js'
import { listMediaImages, uploadMediaImage } from '@softerr/shared/media-client.js'
import { createMediaThumbnailBatcher } from '@softerr/shared/media-thumbnails.js'

export function createImagePicker({ page, requestJson, responseError, setStatus, notice, saveCell }) {
  const imageDialog = page.querySelector('#mdb-image-dialog')
  const imageSearch = page.querySelector('#mdb-image-search')
  const imageGrid = page.querySelector('#mdb-image-grid')
  const imageUpload = page.querySelector('#mdb-image-upload')
  const imageStatus = page.querySelector('#mdb-image-status')
  let imageCell = null
  let imageChoices = []
  let imageLoadGeneration = 0

  const imagePreviews = new Map()
  const imageBatcher = createMediaThumbnailBatcher({
    isActive: () => imageDialog.open,
    onResult(id, url) {
      const preview = imagePreviews.get(id)
      if (preview) preview.src = url
    },
  })
  const imageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      imageObserver.unobserve(entry.target)
      imageBatcher.enqueue(Number(entry.target.dataset.imageId))
    }
  }, { root: imageGrid, rootMargin: '100px' })

  function renderImageChoices() {
    imageObserver.disconnect()
    imageBatcher.clear()
    imagePreviews.clear()
    imageGrid.replaceChildren()
    const tile = (label, icon, action) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'mdb-image-choice'
      button.innerHTML = `<span class="mdb-image-choice-preview">${icon}</span>`
      const name = document.createElement('span')
      name.className = 'mdb-image-choice-name'
      name.textContent = label
      button.append(name)
      button.setAttribute('aria-label', label)
      button.addEventListener('click', action)
      imageGrid.append(button)
      return button
    }
    const empty = tile('No image', noImageIcon, () => chooseImage(null))
    empty.classList.toggle('is-selected', imageCell?.value === null)
    empty.setAttribute('aria-pressed', String(imageCell?.value === null))
    tile('Upload image', uploadImageIcon, () => imageUpload.click())
    const query = imageSearch.value.trim().toLocaleLowerCase()
    for (const image of imageChoices) {
      if (query && !image.name.toLocaleLowerCase().includes(query)) continue
      const button = tile(image.name, imageIcon, () => chooseImage(image.id))
      button.title = image.name
      button.classList.toggle('is-selected', image.id === imageCell?.value)
      button.setAttribute('aria-pressed', String(image.id === imageCell?.value))
      const preview = button.querySelector('.mdb-image-choice-preview')
      const icon = preview.querySelector('svg')
      const thumbnail = document.createElement('img')
      thumbnail.alt = ''
      thumbnail.dataset.imageId = String(image.id)
      thumbnail.addEventListener('load', () => { icon.hidden = true })
      thumbnail.addEventListener('error', () => { thumbnail.remove(); icon.hidden = false })
      preview.append(thumbnail)
      imagePreviews.set(image.id, thumbnail)
      imageObserver.observe(thumbnail)
    }
  }

  async function openImageDialog(cell) {
    imageCell = cell
    imageSearch.value = ''
    imageChoices = []
    renderImageChoices()
    setStatus(imageStatus, 'Loading images…')
    imageDialog.showModal()
    const generation = ++imageLoadGeneration
    try {
      const [response, payload] = await listMediaImages(requestJson)
      if (!imageDialog.open || generation !== imageLoadGeneration) return
      if (!response.ok) throw new Error(responseError(response, payload))
      if (!Array.isArray(payload?.images)) throw new Error('Could not load images.')
      imageChoices = payload.images
      renderImageChoices()
      setStatus(imageStatus, '')
    } catch (error) {
      if (imageDialog.open && generation === imageLoadGeneration) {
        setStatus(imageStatus, error.message || 'Could not load images.', true)
      }
    }
  }

  function chooseImage(id) {
    if (!imageCell) return
    const cell = imageCell
    imageDialog.close()
    if (!cell.button.isConnected) {
      notice.show('The table changed. Open the image picker again.', 'warning')
      return
    }
    const previous = cell.value
    cell.value = id
    saveCell(cell.button, cell.row.id, cell.column.id, id, previous,
      (old) => { cell.value = old }, (saved) => { cell.value = saved })
  }

  imageSearch.addEventListener('input', renderImageChoices)
  page.querySelector('#mdb-image-close').addEventListener('click', () => imageDialog.close())
  imageDialog.addEventListener('close', () => {
    imageLoadGeneration++
    imageObserver.disconnect()
    imageBatcher.clear()
    imagePreviews.clear()
    imageCell = null
  })
  imageUpload.addEventListener('change', async () => {
    const file = imageUpload.files?.[0]
    imageUpload.value = ''
    if (!file) return
    setStatus(imageStatus, `Uploading ${file.name}…`)
    try {
      const [response, payload] = await uploadMediaImage(file)
      if (!imageDialog.open) return
      if (!response.ok) throw new Error(responseError(response, payload))
      imageChoices.push(payload)
      imageChoices.sort((left, right) => left.name.localeCompare(right.name))
      chooseImage(payload.id)
    } catch (error) {
      if (imageDialog.open) setStatus(imageStatus, error.message || 'Could not upload image.', true)
    }
  })

  return { openImageDialog }
}
