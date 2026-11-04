const BATCH_SIZE = 32
const MAX_REQUESTS = 2
const CACHE_SIZE = 160

export function createMediaThumbnailLoader(page) {
  const cache = new Map()
  const pending = new Map()
  const loading = new Set()
  let requests = 0
  let timer = null
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      observer.unobserve(entry.target)
      const image = entry.target
      const id = Number(image.dataset.mediaThumbId)
      if (!id || loading.has(id) || image.getAttribute('src')) continue
      pending.set(id, image)
    }
    if (pending.size && timer === null) timer = setTimeout(flush, 0)
  }, { rootMargin: '120px' })

  function remember(id, src) {
    cache.delete(id)
    cache.set(id, src)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value)
  }

  function currentImages(id) {
    return page.querySelectorAll(`img[data-media-thumb-id="${id}"]`)
  }

  function show(id, src) {
    for (const image of currentImages(id)) {
      if (!image.closest('[hidden]') && page.dataset.mediaLayout !== 'list') image.src = src
    }
  }

  async function load(ids) {
    try {
      const response = await fetch('/api/media/thumbnails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: ids }),
      })
      if (!response.ok) throw new Error('Thumbnail batch failed')
      const payload = await response.json()
      if (!Array.isArray(payload.images)) throw new Error('Invalid thumbnail batch')
      const received = new Set()
      for (const image of payload.images) {
        if (!ids.includes(image.id) || !/^image\/(png|jpeg|webp)$/.test(image.mime_type)
          || typeof image.data !== 'string') continue
        const src = `data:${image.mime_type};base64,${image.data}`
        remember(image.id, src)
        show(image.id, src)
        received.add(image.id)
      }
      for (const id of ids) {
        if (!received.has(id)) show(id, `/api/media/images/${id}/thumbnail`)
      }
    } catch {
      // Keep previews usable if the batch endpoint fails.
      for (const id of ids) show(id, `/api/media/images/${id}/thumbnail`)
    } finally {
      requests--
      for (const id of ids) loading.delete(id)
      flush()
    }
  }

  function flush() {
    clearTimeout(timer)
    timer = null
    if (!page.isConnected) {
      observer.disconnect()
      pending.clear()
      cache.clear()
      return
    }
    while (requests < MAX_REQUESTS && pending.size) {
      const ids = []
      for (const [id, image] of pending) {
        pending.delete(id)
        if (!image.isConnected || image.closest('[hidden]') || loading.has(id)
          || image.getAttribute('src') || page.dataset.mediaLayout === 'list') continue
        ids.push(id)
        loading.add(id)
        if (ids.length === BATCH_SIZE) break
      }
      if (!ids.length) break
      requests++
      load(ids)
    }
  }

  function sync() {
    clearTimeout(timer)
    timer = null
    pending.clear()
    observer.disconnect()
    if (!page.isConnected || page.dataset.mediaLayout === 'list') return
    for (const image of page.querySelectorAll('img[data-media-thumb-id]')) {
      if (image.closest('[hidden]') || image.getAttribute('src')) continue
      const id = Number(image.dataset.mediaThumbId)
      const cached = cache.get(id)
      if (cached) image.src = cached
      else if (!loading.has(id)) observer.observe(image)
    }
  }

  return { sync }
}
