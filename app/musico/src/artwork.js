import { MAX_IMAGE_BYTES, MAX_IMAGE_SIZE_LABEL } from '../../shared/media-limits.js'

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
  let observer = null

  function choose(id) {
    dialog.close()
    resolveChoice?.(id)
    resolveChoice = null
  }

  function draw() {
    const query = search.value.toLocaleLowerCase().trim()
    observer?.disconnect()
    observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.src = entry.target.dataset.src
        observer.unobserve(entry.target)
      }
    }, { root: grid, rootMargin: '120px' }) : null
    grid.replaceChildren()
    const empty = document.createElement('button')
    empty.type = 'button'
    empty.className = 'musico-art-choice'
    empty.innerHTML = '<span class="musico-empty-art">×</span><span>No album art</span>'
    empty.addEventListener('click', () => choose(null))
    grid.append(empty)
    for (const image of images.filter((item) => item.name.toLocaleLowerCase().includes(query))) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'musico-art-choice'
      const thumbnail = document.createElement('img')
      thumbnail.dataset.src = `/api/media/images/${image.id}/thumbnail`
      thumbnail.alt = ''
      thumbnail.loading = 'lazy'
      const name = document.createElement('span')
      name.textContent = image.name
      item.append(thumbnail, name)
      if (observer) observer.observe(thumbnail)
      else thumbnail.src = thumbnail.dataset.src
      item.addEventListener('click', () => choose(image.id))
      grid.append(item)
    }
  }

  async function reload() {
    const [response, payload] = await requestJson('GET', '/api/media/images')
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
    if (file.size > MAX_IMAGE_BYTES) { message.textContent = `Image must be at most ${MAX_IMAGE_SIZE_LABEL}.`; return }
    input.disabled = true
    message.textContent = 'Uploading image…'
    try {
      const response = await fetch('/api/media/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Image-Name': encodeURIComponent(file.name) },
        body: file,
      })
      const payload = await response.json().catch(() => null)
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
