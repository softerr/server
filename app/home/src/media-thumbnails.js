import { createMediaThumbnailBatcher } from '@softerr/shared/media-thumbnails.js'

const CACHE_SIZE = 160

export function createMediaThumbnailLoader(page) {
  const cache = new Map()

  function remember(id, src) {
    cache.delete(id)
    cache.set(id, src)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value)
  }

  function show(id, src) {
    for (const image of page.querySelectorAll(`img[data-media-thumb-id="${id}"]`)) {
      if (!image.closest('[hidden]') && page.dataset.mediaLayout !== 'list') image.src = src
    }
  }

  const batcher = createMediaThumbnailBatcher({
    isActive: () => page.isConnected && page.dataset.mediaLayout !== 'list',
    onResult(id, src) { remember(id, src); show(id, src) },
  })
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      observer.unobserve(entry.target)
      const image = entry.target
      const id = Number(image.dataset.mediaThumbId)
      if (id && !image.getAttribute('src')) batcher.enqueue(id)
    }
  }, { rootMargin: '120px' })

  function sync() {
    observer.disconnect()
    if (!page.isConnected) {
      batcher.clear()
      cache.clear()
      return
    }
    const images = page.dataset.mediaLayout === 'list' ? []
      : [...page.querySelectorAll('img[data-media-thumb-id]')].filter((image) => !image.closest('[hidden]'))
    batcher.retain(images.map((image) => Number(image.dataset.mediaThumbId)))
    for (const image of images) {
      if (image.getAttribute('src')) continue
      const id = Number(image.dataset.mediaThumbId)
      const cached = cache.get(id)
      if (cached) image.src = cached
      else observer.observe(image)
    }
  }

  return { sync }
}
