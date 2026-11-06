import assert from 'node:assert/strict'
import test from 'node:test'
import { formatBytes } from '../../app/shared/format.js'
import { uploadMediaImage } from '../../app/shared/media-client.js'
import { createMediaThumbnailBatcher } from '../../app/shared/media-thumbnails.js'

test('byte formatting keeps app display conventions', () => {
  assert.equal(formatBytes(1536), '1.5 KiB')
  assert.equal(formatBytes(0, { minimumUnit: 'MiB' }), '0.0 MiB')
  assert.equal(formatBytes(1025, { minimumUnit: 'KiB', roundUp: true }), '2 KiB')
})

test('image upload rejects oversized files before sending a request', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('The request should not be sent') }
  try {
    await assert.rejects(uploadMediaImage({ name: 'large.png', size: 7 * 1024 * 1024 }), RangeError)
  } finally { globalThis.fetch = originalFetch }
})

test('image upload preserves the filename in the request header', async () => {
  const originalFetch = globalThis.fetch
  const file = { name: 'café image.png', size: 42 }
  let request
  globalThis.fetch = (url, options) => {
    request = { url, options }
    return Promise.resolve({ ok: true, json: async () => ({ id: 7 }) })
  }
  try {
    const [response, payload] = await uploadMediaImage(file)
    assert.equal(response.ok, true)
    assert.deepEqual(payload, { id: 7 })
    assert.equal(request.url, '/api/media/images')
    assert.equal(request.options.headers['X-Image-Name'], encodeURIComponent(file.name))
    assert.equal(request.options.body, file)
  } finally { globalThis.fetch = originalFetch }
})

test('shared image uploads use the selected group endpoint', async () => {
  const originalFetch = globalThis.fetch
  let path
  globalThis.fetch = (url) => {
    path = url
    return Promise.resolve({ ok: true, json: async () => ({ id: 7 }) })
  }
  try {
    await uploadMediaImage({ name: 'cover.png', size: 42 }, 'cover.png', '/api/media/groups/5/images')
    assert.equal(path, '/api/media/groups/5/images')
  } finally { globalThis.fetch = originalFetch }
})

test('thumbnail batches ignore results from a replaced search', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = (_url, options) => new Promise((resolve) => {
    requests.push({ options, resolve })
  })
  const delivered = []
  const batcher = createMediaThumbnailBatcher({ isActive: () => true, onResult: (id, src) => delivered.push([id, src]) })
  try {
    batcher.enqueue(4)
    await new Promise((resolve) => setTimeout(resolve, 0))
    batcher.retain([])
    batcher.enqueue(4)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requests.length, 2)
    requests[0].resolve({ ok: true, json: async () => ({ images: [{ id: 4, mime_type: 'image/webp', data: 'b2xk' }] }) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(delivered, [])
    requests[1].resolve({ ok: true, json: async () => ({ images: [{ id: 4, mime_type: 'image/webp', data: 'bmV3' }] }) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(delivered, [[4, 'data:image/webp;base64,bmV3']])
  } finally {
    batcher.clear()
    globalThis.fetch = originalFetch
  }
})
