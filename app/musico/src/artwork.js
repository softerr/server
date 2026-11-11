import { listMediaImages, uploadMediaImage } from '@softerr/shared/media-client.js'
import { createMediaThumbnailBatcher } from '@softerr/shared/media-thumbnails.js'

export function mountArtworkPicker(page, { requestJson, responseError }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'musico-dialog musico-art-dialog'
  dialog.innerHTML = `
    <div class="musico-art-heading"><h2>Choose album art</h2><button type="button" data-close aria-label="Close image picker">×</button></div>
    <input data-search type="search" placeholder="Search images" aria-label="Search images">
    <div data-grid class="musico-art-grid"></div>
    <label class="auth-button auth-button-secondary musico-upload">Upload image<input data-upload type="file" accept="image/png,image/jpeg,image/webp" hidden></label>
    <p data-status class="form-status" role="status" aria-live="polite"></p>
  `
  page.append(dialog)
  const grid = dialog.querySelector('[data-grid]')
  const search = dialog.querySelector('[data-search]')
  const message = dialog.querySelector('[data-status]')
  let images = []
  let resolveChoice = null
  const cache = new Map()
  const batcher = createMediaThumbnailBatcher({
    isActive: () => dialog.open,
    onResult(id, src) {
      cache.set(id, src)
      if (cache.size > 160) cache.delete(cache.keys().next().value)
      const preview = grid.querySelector(`img[data-image-id="${id}"]`)
      if (preview) preview.src = src
    },
  })
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      observer.unobserve(entry.target)
      batcher.enqueue(Number(entry.target.dataset.imageId))
    }
  }, { root: grid, rootMargin: '120px' }) : null

  function choose(id) {
    dialog.close()
    observer?.disconnect()
    batcher.clear()
    resolveChoice?.(id)
    resolveChoice = null
  }

  function draw() {
    const query = search.value.toLocaleLowerCase().trim()
    const visible = images.filter((item) => item.name.toLocaleLowerCase().includes(query))
    observer?.disconnect()
    batcher.retain(visible.map((image) => image.id))
    grid.replaceChildren()
    const empty = document.createElement('button')
    empty.type = 'button'
    empty.className = 'musico-art-choice'
    empty.innerHTML = '<span class="musico-empty-art">×</span><span>No album art</span>'
    empty.addEventListener('click', () => choose(null))
    grid.append(empty)
    for (const image of visible) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'musico-art-choice'
      const thumbnail = document.createElement('img')
      thumbnail.dataset.imageId = String(image.id)
      thumbnail.alt = ''
      thumbnail.loading = 'lazy'
      const name = document.createElement('span')
      name.textContent = image.name
      item.append(thumbnail, name)
      const cached = cache.get(image.id)
      if (cached) thumbnail.src = cached
      else if (observer) observer.observe(thumbnail)
      else batcher.enqueue(image.id)
      item.addEventListener('click', () => choose(image.id))
      grid.append(item)
    }
  }

  async function reload() {
    const [response, payload] = await listMediaImages(requestJson)
    if (!response.ok) throw new Error(responseError(response, payload))
    images = payload.images ?? []
    draw()
  }

  dialog.querySelector('[data-close]').addEventListener('click', () => choose(undefined))
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); choose(undefined) })
  search.addEventListener('input', draw)
  dialog.querySelector('[data-upload]').addEventListener('change', async (event) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    input.disabled = true
    message.textContent = 'Uploading image…'
    try {
      const [response, payload] = await uploadMediaImage(file)
      if (!response.ok) throw new Error(responseError(response, payload))
      choose(payload.id)
    } catch (error) { message.textContent = error.message }
    finally { input.disabled = false }
  })

  return {
    async open() {
      search.value = ''
      message.textContent = 'Loading images…'
      dialog.showModal()
      const selected = new Promise((resolve) => { resolveChoice = resolve })
      try { await reload(); message.textContent = '' }
      catch (error) { message.textContent = error.message }
      search.focus()
      return selected
    },
  }
}
