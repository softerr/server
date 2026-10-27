import { imageIcon, noImageIcon, removeIcon, uploadImageIcon } from './icons.js'

const imageUrl = (id) => `/api/quiz/images/${id}`

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1048576).toFixed(1)} MiB`
}

export function mountImageLibrary(section, { requestJson, responseError, setStatus }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'quiz-dialog image-library-dialog'
  dialog.innerHTML = `
    <div class="image-library-heading">
      <h2>Choose image</h2>
      <button type="button" class="image-library-close" data-close aria-label="Close image picker" title="Close">${removeIcon}</button>
    </div>
    <p>PNG, JPEG, or WebP images can be reused in any quiz.</p>
    <div class="image-library-usage" aria-live="polite">
      <div class="image-library-usage-bars" hidden>
        <div class="image-library-usage-row">
          <div class="image-library-usage-label"><span>Images</span><span data-image-count></span></div>
          <progress data-image-count-bar aria-label="Image count used"></progress>
        </div>
        <div class="image-library-usage-row">
          <div class="image-library-usage-label"><span>Storage</span><span data-image-storage></span></div>
          <progress data-image-storage-bar aria-label="Image storage used"></progress>
        </div>
        <p class="image-library-per-image" data-image-per-limit></p>
      </div>
      <p class="image-library-usage-message">Loading image limits…</p>
    </div>
    <input type="file" accept="image/png,image/jpeg,image/webp" hidden>
    <div class="image-library-grid">
      <div class="image-library-item" data-upload-tile>
        <button type="button" class="image-library-choice image-library-choice-upload" data-upload aria-label="Upload image" title="Upload image">${uploadImageIcon}</button>
        <span class="image-library-name">Upload image</span>
      </div>
    </div>
    <p class="form-status" role="status" aria-live="polite"></p>
  `
  section.append(dialog)
  const input = dialog.querySelector('input')
  const grid = dialog.querySelector('.image-library-grid')
  const uploadTile = grid.querySelector('[data-upload-tile]')
  const usage = dialog.querySelector('.image-library-usage')
  const usageBars = usage.querySelector('.image-library-usage-bars')
  const usageMessage = usage.querySelector('.image-library-usage-message')
  const countLabel = usage.querySelector('[data-image-count]')
  const countBar = usage.querySelector('[data-image-count-bar]')
  const storageLabel = usage.querySelector('[data-image-storage]')
  const storageBar = usage.querySelector('[data-image-storage-bar]')
  const perImageLabel = usage.querySelector('[data-image-per-limit]')
  const status = dialog.querySelector('.form-status')
  const upload = dialog.querySelector('[data-upload]')
  let images = []
  let active = null
  const pickers = new Set()

  function updatePicker(picker) {
    const id = Number(picker.querySelector('[data-image-id]').value)
    const button = picker.querySelector('[data-choose-image]')
    const preview = button.querySelector('img')
    const icon = button.querySelector('svg')
    const label = picker.dataset.imageLabel
    const name = images.find((image) => image.id === id)?.name
    preview.hidden = !id
    icon.hidden = Boolean(id)
    if (id) preview.src = imageUrl(id)
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
    const field = document.createElement('input')
    field.type = 'hidden'
    field.dataset.imageId = ''
    field.value = id ? String(id) : ''
    const choose = document.createElement('button')
    choose.type = 'button'
    choose.className = 'image-picker-button'
    choose.dataset.chooseImage = ''
    choose.innerHTML = imageIcon
    choose.append(preview)
    choose.addEventListener('click', async () => {
      active = picker
      setStatus(status, 'Loading images…')
      dialog.showModal()
      await refresh()
    })
    picker.append(field, choose)
    pickers.add(picker)
    updatePicker(picker)
    return picker
  }

  function render() {
    const emptyTile = document.createElement('div')
    emptyTile.className = 'image-library-item'
    const emptyChoice = document.createElement('button')
    emptyChoice.type = 'button'
    emptyChoice.className = 'image-library-choice image-library-choice-empty'
    emptyChoice.setAttribute('aria-label', 'Use no image')
    emptyChoice.innerHTML = noImageIcon
    emptyChoice.addEventListener('click', () => {
      if (active) setImage(active, null)
      dialog.close()
    })
    const emptyName = document.createElement('span')
    emptyName.className = 'image-library-name'
    emptyName.textContent = 'No image'
    emptyTile.append(emptyChoice, emptyName)
    grid.replaceChildren(emptyTile, uploadTile)
    for (const image of images) {
      const tile = document.createElement('div')
      tile.className = 'image-library-item'
      const choose = document.createElement('button')
      choose.type = 'button'
      choose.className = 'image-library-choice'
      choose.setAttribute('aria-label', `Use ${image.name}`)
      choose.title = image.name
      const preview = document.createElement('img')
      preview.src = imageUrl(image.id)
      preview.alt = ''
      preview.loading = 'lazy'
      choose.append(preview)
      choose.addEventListener('click', () => {
        if (active) setImage(active, image.id)
        dialog.close()
      })
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'text-button'
      remove.textContent = 'Delete'
      remove.setAttribute('aria-label', `Delete ${image.name}`)
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete this image from your library?')) return
        remove.disabled = true
        try {
          const [response, payload] = await requestJson('DELETE', imageUrl(image.id))
          if (!response.ok) {
            setStatus(status, responseError(response, payload), true)
            return
          }
          for (const picker of pickers) {
            if (picker.isConnected && Number(picker.querySelector('[data-image-id]').value) === image.id) {
              setImage(picker, null)
            }
          }
          images = images.filter((item) => item.id !== image.id)
          render()
          if (await refresh()) setStatus(status, 'Image deleted.')
        } catch {
          setStatus(status, 'Could not delete image.', true)
        } finally {
          remove.disabled = false
        }
      })
      const name = document.createElement('span')
      name.className = 'image-library-name'
      name.textContent = image.name
      name.title = image.name
      tile.append(choose, name, remove)
      grid.append(tile)
    }
  }

  async function refresh() {
    try {
      const [response, payload] = await requestJson('GET', '/api/quiz/images')
      if (!response.ok) {
        usageBars.hidden = true
        usageMessage.hidden = false
        usageMessage.textContent = 'Image usage unavailable.'
        setStatus(status, responseError(response, payload), true)
        return
      }
      images = payload.images
      countLabel.textContent = `${payload.usage.count} / ${payload.limits.count}`
      countBar.max = payload.limits.count
      countBar.value = payload.usage.count
      storageLabel.textContent = `${formatBytes(payload.usage.bytes)} / ${formatBytes(payload.limits.bytes)}`
      storageBar.max = payload.limits.bytes
      storageBar.value = payload.usage.bytes
      perImageLabel.textContent = `${formatBytes(payload.limits.per_image_bytes)} max per image`
      usageBars.hidden = false
      usageMessage.hidden = true
      render()
      for (const picker of pickers) if (picker.isConnected) updatePicker(picker)
      setStatus(status, '')
      return true
    } catch {
      usageBars.hidden = true
      usageMessage.hidden = false
      usageMessage.textContent = 'Image usage unavailable.'
      setStatus(status, 'Could not load images.', true)
    }
    return false
  }

  upload.addEventListener('click', () => input.click())
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.size > 2097152) {
      setStatus(status, 'Image must be at most 2 MiB.', true)
      return
    }
    upload.disabled = true
    setStatus(status, 'Uploading image…')
    try {
      const response = await fetch('/api/quiz/images', {
        method: 'POST', headers: {
          'Content-Type': 'application/octet-stream',
          'X-Image-Name': encodeURIComponent(file.name),
        }, body: file,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setStatus(status, responseError(response, payload), true)
        return
      }
      await refresh()
      if (active?.isConnected) setImage(active, payload.id)
      dialog.close()
    } catch {
      setStatus(status, 'Could not upload image.', true)
    } finally {
      upload.disabled = false
    }
  })
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close())
  render()
  return { createPicker, setImage }
}
