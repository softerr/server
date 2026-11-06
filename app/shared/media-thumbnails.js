import { fetchMediaThumbnails, mediaThumbnailUrl } from './media-client.js'

export function createMediaThumbnailBatcher({ onResult, isActive, batchSize = 32, maxRequests = 2 }) {
  const wanted = new Map()
  const pending = new Set()
  const batches = new Set()
  let timer = null

  function schedule() {
    if (timer === null) timer = setTimeout(flush, 0)
  }

  async function load(batch) {
    let sources = null
    try {
      sources = await fetchMediaThumbnails(batch.ids, batch.controller.signal)
    } catch {
      if (!batch.controller.signal.aborted) sources = new Map()
    } finally {
      batches.delete(batch)
      for (const id of batch.ids) {
        if (wanted.get(id) !== batch.tokens.get(id)) continue
        wanted.delete(id)
        if (sources) onResult(id, sources.get(id) ?? mediaThumbnailUrl(id))
      }
      flush()
    }
  }

  function flush() {
    clearTimeout(timer)
    timer = null
    if (!isActive()) return
    while (batches.size < maxRequests && pending.size) {
      const ids = [...pending].slice(0, batchSize)
      for (const id of ids) pending.delete(id)
      const batch = { ids, tokens: new Map(ids.map((id) => [id, wanted.get(id)])), controller: new AbortController() }
      batches.add(batch)
      load(batch)
    }
  }

  function enqueue(id) {
    if (!Number.isSafeInteger(id) || id < 1 || wanted.has(id)) return
    wanted.set(id, Symbol())
    pending.add(id)
    schedule()
  }

  function retain(ids) {
    const keep = new Set(ids)
    for (const id of wanted.keys()) if (!keep.has(id)) wanted.delete(id)
    for (const id of pending) if (!keep.has(id)) pending.delete(id)
    for (const batch of batches) {
      if (!batch.ids.some((id) => wanted.get(id) === batch.tokens.get(id))) batch.controller.abort()
    }
  }

  function clear() {
    clearTimeout(timer)
    timer = null
    wanted.clear()
    pending.clear()
    for (const batch of batches) batch.controller.abort()
  }

  return { enqueue, retain, clear }
}
