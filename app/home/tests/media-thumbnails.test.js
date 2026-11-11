import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaThumbnailLoader } from '../src/media-thumbnails.js'

test('visible Media thumbnails load in batches and reuse loaded data', async () => {
  const originalObserver = globalThis.IntersectionObserver
  const originalFetch = globalThis.fetch
  let observer
  const requests = []
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.observed = new Set(); observer = this }
    observe(image) { this.observed.add(image) }
    unobserve(image) { this.observed.delete(image) }
    disconnect() { this.observed.clear() }
    showVisible() {
      this.callback([...this.observed].map((target) => ({ target, isIntersecting: true })))
    }
  }
  globalThis.fetch = async (_url, options) => {
    const ids = JSON.parse(options.body).image_ids
    requests.push(ids)
    return { ok: true, json: async () => ({ images: ids.map((id) =>
      ({ id, mime_type: 'image/webp', data: 'YQ==' })) }) }
  }
  try {
    const images = Array.from({ length: 35 }, (_, index) => ({
      dataset: { mediaThumbId: String(index + 1) },
      isConnected: true,
      src: '',
      closest: () => null,
      getAttribute(name) { return name === 'src' ? this.src || null : null },
    }))
    const page = {
      isConnected: true,
      dataset: { mediaLayout: 'medium' },
      querySelectorAll(selector) {
        if (selector === 'img[data-media-thumb-id]') return images
        const id = Number(selector.match(/="(\d+)"/)?.[1])
        return images.filter((image) => Number(image.dataset.mediaThumbId) === id)
      },
    }
    const loader = createMediaThumbnailLoader(page)
    loader.sync()
    assert.equal(observer.observed.size, 35)
    observer.showVisible()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(requests.map((batch) => batch.length), [32, 3])
    assert.ok(images.every((image) => image.src === 'data:image/webp;base64,YQ=='))
    images[0].src = ''
    loader.sync()
    assert.equal(images[0].src, 'data:image/webp;base64,YQ==')
    assert.equal(requests.length, 2)
  } finally {
    globalThis.IntersectionObserver = originalObserver
    globalThis.fetch = originalFetch
  }
})
