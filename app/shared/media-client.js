import { MAX_IMAGE_BYTES, MAX_IMAGE_SIZE_LABEL } from './media-limits.js'

export const mediaImageUrl = (id) => `/api/media/images/${id}`
export const mediaThumbnailUrl = (id) => `${mediaImageUrl(id)}/thumbnail`

export function listMediaImages(requestJson) {
  return requestJson('GET', '/api/media/images')
}

export async function uploadMediaImage(file, name = file.name, path = '/api/media/images') {
  if (file.size > MAX_IMAGE_BYTES) throw new RangeError(`Image must be at most ${MAX_IMAGE_SIZE_LABEL}.`)
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Image-Name': encodeURIComponent(name) },
    body: file,
  })
  return [response, await response.json().catch(() => null)]
}

export async function fetchMediaThumbnails(ids, signal) {
  const response = await fetch('/api/media/thumbnails', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_ids: ids }), signal,
  })
  if (!response.ok) throw new Error('Thumbnail batch failed')
  const payload = await response.json()
  if (!Array.isArray(payload.images)) throw new Error('Invalid thumbnail batch')
  const requested = new Set(ids)
  const sources = new Map()
  for (const image of payload.images) {
    if (!requested.has(image.id) || !/^image\/(png|jpeg|webp)$/.test(image.mime_type)
      || typeof image.data !== 'string') continue
    sources.set(image.id, `data:${image.mime_type};base64,${image.data}`)
  }
  return sources
}
