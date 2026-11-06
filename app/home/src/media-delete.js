import { mediaImageUrl } from '../../shared/media-client.js'

export function createMediaDeletion(page, { requestJson, responseError, notify }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'user-dialog media-delete-dialog'
  dialog.setAttribute('aria-labelledby', 'media-delete-title')
  dialog.innerHTML = `
    <h2 id="media-delete-title">Delete selected images</h2>
    <p data-delete-summary></p>
    <div class="media-delete-uses" data-delete-uses></div>
    <p class="form-status" data-delete-status role="status" aria-live="polite"></p>
    <div class="user-dialog-actions">
      <button type="button" class="auth-button auth-button-secondary" data-delete-cancel>Cancel</button>
      <button type="button" class="auth-button auth-button-primary" data-delete-confirm disabled>Delete selected</button>
    </div>
  `
  page.append(dialog)
  const summary = dialog.querySelector('[data-delete-summary]')
  const uses = dialog.querySelector('[data-delete-uses]')
  const status = dialog.querySelector('[data-delete-status]')
  const cancel = dialog.querySelector('[data-delete-cancel]')
  const confirm = dialog.querySelector('[data-delete-confirm]')
  let pending = null
  let busy = false

  function renderUsage(images) {
    uses.replaceChildren()
    const affected = images.filter((image) => image.uses.length)
    const totalUses = affected.reduce((count, image) => count + image.uses.length, 0)
    summary.textContent = affected.length
      ? `${affected.length} of ${images.length} selected images are used in ${totalUses} places. Deleting them will show a missing-image icon there.`
      : `None of the ${images.length} selected images are in use.`
    for (const image of affected) {
      const group = document.createElement('section')
      const title = document.createElement('h3')
      title.textContent = image.name
      const list = document.createElement('ul')
      for (const place of image.uses) {
        const item = document.createElement('li')
        item.textContent = place.kind === 'musico_track'
          ? `Musico · ${place.track_name} (song #${place.track_id})`
          : `${place.quiz_name} · ${place.kind === 'attempt' ? `Saved attempt #${place.attempt_id}` : 'Current question'} · ${place.question_prompt} (question #${place.question_id})`
        list.append(item)
      }
      group.append(title, list)
      uses.append(group)
    }
    confirm.textContent = affected.length ? 'Delete anyway' : 'Delete selected'
    return new Set(affected.map((image) => image.id))
  }

  async function open(ids, { selected, refresh, setBusy }) {
    if (busy || !ids.length) return
    busy = true
    pending = null
    summary.textContent = `Checking ${ids.length} selected image${ids.length === 1 ? '' : 's'}…`
    uses.replaceChildren()
    status.textContent = ''
    confirm.disabled = true
    dialog.showModal()
    try {
      const [response, payload] = await requestJson('POST', '/api/media/images/usage', { image_ids: ids })
      if (!dialog.open) return
      if (!response.ok || !Array.isArray(payload?.images)) {
        status.textContent = responseError(response, payload)
        return
      }
      pending = { ids, selected, refresh, setBusy, forceIds: renderUsage(payload.images) }
      confirm.disabled = false
    } catch {
      if (dialog.open) status.textContent = 'Could not check where these images are used.'
    } finally { busy = false }
  }

  confirm.addEventListener('click', async () => {
    if (busy || !pending) return
    busy = true
    const { ids, selected, refresh, setBusy, forceIds } = pending
    confirm.disabled = true
    cancel.disabled = true
    setBusy(true)
    status.textContent = `Deleting ${ids.length} image${ids.length === 1 ? '' : 's'}…`
    let deleted = 0
    const failures = []
    for (const id of ids) {
      try {
        const [response, payload] = await requestJson('DELETE', `${mediaImageUrl(id)}${forceIds.has(id) ? '?force=1' : ''}`)
        if (!page.isConnected) return
        if (response.ok) { selected.delete(id); deleted++ }
        else failures.push(responseError(response, payload))
      } catch { failures.push('Could not delete an image.') }
    }
    try { if (!await refresh()) failures.push('Could not reload the library.') }
    catch { failures.push('Could not reload the library.') }
    setBusy(false)
    busy = false
    cancel.disabled = false
    if (!page.isConnected) return
    dialog.close()
    notify(`${deleted} image${deleted === 1 ? '' : 's'} deleted${failures.length ? `. ${failures[0]}` : '.'}`,
      failures.length ? (deleted ? 'warning' : 'error') : 'success')
  })
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault() })
  cancel.addEventListener('click', () => { if (!busy) dialog.close() })
  return { open }
}
