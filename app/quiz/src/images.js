import { imageIcon, noImageIcon, removeIcon, uploadImageIcon } from './icons.js'
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIZE_LABEL } from '../../shared/media-limits.js'

const imageUrl = (id) => `/api/media/images/${id}`

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
    <p data-library-description>Personal images can be reused across apps. Shared images do not use your storage limit.</p>
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
    <div class="image-library-tabs" aria-label="Image source">
      <button type="button" data-source-tab="local" aria-pressed="true">My library</button>
      <button type="button" data-source-tab="online" aria-pressed="false">Online</button>
    </div>
    <label class="field image-library-search">
      <span data-search-label>Search images</span>
      <input type="search" data-image-search placeholder="Search by name" autocomplete="off">
    </label>
    <input type="file" data-image-upload-input accept="image/png,image/jpeg,image/webp" multiple hidden>
    <div class="image-library-grid">
      <div class="image-library-item" data-upload-tile>
        <button type="button" class="image-library-choice image-library-choice-upload" data-upload aria-label="Upload image" title="Upload image">${uploadImageIcon}</button>
        <span class="image-library-name">Upload image</span>
      </div>
    </div>
    <div class="image-library-multi-actions" hidden>
      <span>Choose several images; empty rows are filled first.</span>
      <button type="button" class="auth-button auth-button-primary" data-add-selected disabled>Add images</button>
    </div>
    <p class="form-status" role="status" aria-live="polite"></p>
  `
  section.append(dialog)
  const input = dialog.querySelector('[data-image-upload-input]')
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
  const search = dialog.querySelector('[data-image-search]')
  const searchLabel = dialog.querySelector('[data-search-label]')
  const description = dialog.querySelector('[data-library-description]')
  const sourceTabs = dialog.querySelectorAll('[data-source-tab]')
  const status = dialog.querySelector('.form-status')
  const upload = dialog.querySelector('[data-upload]')
  const multiActions = dialog.querySelector('.image-library-multi-actions')
  const addSelected = dialog.querySelector('[data-add-selected]')
  let images = []
  let active = null
  let onChooseMany = null
  let selectionAnchor = null
  const selectedIds = new Set()
  const pickers = new Set()
  const imageLoads = new Map()
  const visiblePreviews = new Map()
  let loadTimer = null
  let sourceMode = 'local'
  let onlineResults = []
  let onlineSearchTimer = null
  let onlineSearchController = null
  const imageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      imageObserver.unobserve(entry.target)
      const id = Number(entry.target.dataset.libraryPreviewId)
      if (!imageLoads.has(id)) loadPreview(id)
    }
  }, { root: dialog, rootMargin: '80px' })

  async function loadPreview(id) {
    const load = { controller: new AbortController(), url: null }
    imageLoads.set(id, load)
    try {
      const response = await fetch(imageUrl(id), { signal: load.controller.signal })
      if (!response.ok) return
      const blob = await response.blob()
      if (load.controller.signal.aborted || imageLoads.get(id) !== load) return
      load.url = URL.createObjectURL(blob)
      const preview = visiblePreviews.get(id)
      if (preview) preview.src = load.url
    } catch {
      // Searches and dialog closure cancel image requests in progress.
    } finally {
      if (imageLoads.get(id) === load && !load.url) imageLoads.delete(id)
    }
  }

  function stopImageLoads() {
    clearTimeout(loadTimer)
    imageObserver.disconnect()
    for (const load of imageLoads.values()) {
      load.controller.abort()
      if (load.url) URL.revokeObjectURL(load.url)
    }
    imageLoads.clear()
    visiblePreviews.clear()
  }

  function stopOnlineSearch() {
    clearTimeout(onlineSearchTimer)
    onlineSearchController?.abort()
    onlineSearchController = null
  }

  function setSourceMode(mode) {
    stopOnlineSearch()
    if (mode === 'online') stopImageLoads()
    sourceMode = mode
    onlineResults = []
    search.value = ''
    searchLabel.textContent = mode === 'online' ? 'Search Wikimedia Commons' : 'Search images'
    search.placeholder = mode === 'online' ? 'Enter at least two characters' : 'Search by name'
    description.textContent = mode === 'online'
      ? 'Select an image to save it to your uploads. Check its source and license before using it.'
      : 'Personal images can be reused across apps. Shared images do not use your storage limit.'
    for (const tab of sourceTabs) tab.setAttribute('aria-pressed', String(tab.dataset.sourceTab === mode))
    multiActions.hidden = mode === 'online' || !onChooseMany
    setStatus(status, '')
    render()
  }

  function renderOnline(message = 'Search for images to add to your library.') {
    grid.replaceChildren()
    if (!onlineResults.length) {
      const empty = document.createElement('p')
      empty.className = 'image-library-no-results'
      empty.textContent = message
      grid.append(empty)
      return
    }
    for (const result of onlineResults) {
      const tile = document.createElement('div')
      tile.className = 'image-library-item'
      const choose = document.createElement('button')
      choose.type = 'button'
      choose.className = 'image-library-choice'
      choose.setAttribute('aria-label', `Import ${result.name}`)
      choose.title = `Import ${result.name}`
      const thumbnail = document.createElement('img')
      thumbnail.src = result.thumbnail_url
      thumbnail.alt = ''
      thumbnail.loading = 'lazy'
      choose.append(thumbnail)
      choose.addEventListener('click', async () => {
        choose.disabled = true
        setStatus(status, `Importing ${result.name}…`)
        try {
          const [response, image] = await requestJson('POST', '/api/media/images/import', { id: result.id })
          if (!dialog.open) return
          if (!response.ok) {
            setStatus(status, responseError(response, image), true)
            return
          }
          setSourceMode('local')
          if (!await refresh()) return
          if (onChooseMany) {
            selectedIds.add(image.id)
            updateMultiSelection()
            setStatus(status, 'Image added to your library.', false, true)
          } else {
            if (active?.isConnected) setImage(active, image.id)
            dialog.close()
          }
        } catch {
          setStatus(status, 'Could not import image.', true)
        } finally {
          choose.disabled = false
        }
      })
      const name = document.createElement('span')
      name.className = 'image-library-name'
      name.textContent = result.name
      name.title = result.name
      const source = document.createElement('a')
      source.className = 'image-library-source'
      source.href = result.source_page
      source.target = '_blank'
      source.rel = 'noopener noreferrer'
      source.textContent = 'Source and license'
      tile.append(choose, name, source)
      grid.append(tile)
    }
  }

  function searchOnline() {
    stopOnlineSearch()
    const query = search.value.trim()
    onlineResults = []
    if (query.length < 2) {
      renderOnline('Enter at least two characters to search Wikimedia Commons.')
      return
    }
    renderOnline('Searching…')
    onlineSearchTimer = setTimeout(async () => {
      const controller = new AbortController()
      onlineSearchController = controller
      try {
        const response = await fetch(`/api/media/online-search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal })
        const payload = await response.json().catch(() => null)
        if (controller.signal.aborted || sourceMode !== 'online') return
        if (!response.ok) {
          renderOnline(responseError(response, payload))
          return
        }
        onlineResults = Array.isArray(payload?.results) ? payload.results : []
        renderOnline('No matching images within the upload limits.')
      } catch {
        if (!controller.signal.aborted) renderOnline('Could not search online images.')
      }
    }, 350)
  }

  function updateMultiSelection() {
    addSelected.disabled = selectedIds.size === 0
    addSelected.textContent = selectedIds.size ? `Add ${selectedIds.size} image${selectedIds.size === 1 ? '' : 's'}` : 'Add images'
    for (const button of grid.querySelectorAll('[data-library-image-id]')) {
      const selected = selectedIds.has(Number(button.dataset.libraryImageId))
      button.classList.toggle('is-selected', selected)
      if (onChooseMany) button.setAttribute('aria-pressed', String(selected))
      else button.removeAttribute('aria-pressed')
    }
  }

  async function openLibrary(picker = null, callback = null) {
    active = picker
    onChooseMany = callback
    selectedIds.clear()
    selectionAnchor = null
    multiActions.hidden = !callback
    input.multiple = Boolean(callback)
    upload.setAttribute('aria-label', callback ? 'Upload images' : 'Upload image')
    upload.title = callback ? 'Upload images' : 'Upload image'
    uploadTile.querySelector('.image-library-name').textContent = callback ? 'Upload images' : 'Upload image'
    dialog.querySelector('.image-library-heading h2').textContent = callback ? 'Choose images' : 'Choose image'
    setSourceMode('local')
    setStatus(status, 'Loading images…')
    dialog.showModal()
    await refresh()
  }

  function chooseMany(callback) {
    openLibrary(null, callback)
  }

  function updatePicker(picker) {
    const id = Number(picker.querySelector('[data-image-id]').value)
    const button = picker.querySelector('[data-choose-image]')
    const preview = button.querySelector('img')
    const icon = button.querySelector('svg')
    const label = picker.dataset.imageLabel
    const name = images.find((image) => image.id === id)?.name
    preview.hidden = !id
    icon.toggleAttribute('hidden', Boolean(id))
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
    choose.addEventListener('click', () => openLibrary(picker))
    picker.append(field, choose)
    pickers.add(picker)
    updatePicker(picker)
    return picker
  }

  function render() {
    if (sourceMode === 'online') {
      renderOnline()
      return
    }
    const query = search.value.trim().toLocaleLowerCase()
    const visibleImages = query
      ? images.filter((image) => image.name.toLocaleLowerCase().includes(query))
      : images
    const visibleIds = new Set(visibleImages.map((image) => image.id))
    clearTimeout(loadTimer)
    imageObserver.disconnect()
    visiblePreviews.clear()
    for (const [id, load] of imageLoads) {
      if (visibleIds.has(id)) continue
      load.controller.abort()
      if (load.url) URL.revokeObjectURL(load.url)
      imageLoads.delete(id)
    }
    const emptyTile = document.createElement('div')
    emptyTile.className = 'image-library-item'
    const emptyChoice = document.createElement('button')
    emptyChoice.type = 'button'
    emptyChoice.className = 'image-library-choice image-library-choice-empty'
    emptyChoice.setAttribute('aria-label', 'Use no image')
    emptyChoice.innerHTML = noImageIcon
    emptyChoice.addEventListener('click', () => {
      if (onChooseMany) return
      if (active) setImage(active, null)
      dialog.close()
    })
    const emptyName = document.createElement('span')
    emptyName.className = 'image-library-name'
    emptyName.textContent = 'No image'
    emptyTile.append(emptyChoice, emptyName)
    grid.replaceChildren(emptyTile, uploadTile)
    emptyTile.hidden = Boolean(onChooseMany)
    for (const scope of ['shared', 'personal']) {
      const group = visibleImages.filter((image) => image.scope === scope)
      if (!group.length) continue
      const heading = document.createElement('h3')
      heading.className = 'image-library-group-title'
      heading.textContent = scope === 'shared' ? 'Shared images' : 'My images'
      grid.append(heading)
      for (const image of group) {
      const tile = document.createElement('div')
      tile.className = 'image-library-item'
      const choose = document.createElement('button')
      choose.type = 'button'
      choose.className = 'image-library-choice'
      choose.setAttribute('aria-label', `Use ${image.name}`)
      choose.title = image.name
      choose.dataset.libraryImageId = String(image.id)
      const preview = document.createElement('img')
      preview.alt = ''
      preview.dataset.libraryPreviewId = String(image.id)
      const loaded = imageLoads.get(image.id)
      if (loaded?.url) preview.src = loaded.url
      visiblePreviews.set(image.id, preview)
      choose.append(preview)
      choose.addEventListener('click', (event) => {
        if (onChooseMany) {
          const orderedIds = visibleImages.map((item) => item.id)
          const start = orderedIds.indexOf(selectionAnchor)
          const end = orderedIds.indexOf(image.id)
          if (event.shiftKey && start !== -1) {
            for (const id of orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1)) selectedIds.add(id)
          } else if (selectedIds.has(image.id)) selectedIds.delete(image.id)
          else selectedIds.add(image.id)
          selectionAnchor = image.id
          updateMultiSelection()
          return
        }
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
          selectedIds.delete(image.id)
          render()
          if (await refresh()) setStatus(status, 'Image deleted.', false, true)
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
      tile.append(choose, name)
      if (image.source) {
        const source = document.createElement('a')
        source.className = 'image-library-source'
        source.href = image.source.page
        source.target = '_blank'
        source.rel = 'noopener noreferrer'
        source.textContent = image.source.license
        source.title = image.source.attribution || image.source.creator || image.source.license
        tile.append(source)
      }
      if (scope === 'personal') tile.append(remove)
      grid.append(tile)
      }
    }
    if (query && !visibleImages.length) {
      const noResults = document.createElement('p')
      noResults.className = 'image-library-no-results'
      noResults.textContent = 'No images match your search.'
      grid.append(noResults)
    }
    updateMultiSelection()
    if (dialog.open) {
      loadTimer = setTimeout(() => {
        for (const [id, preview] of visiblePreviews) {
          if (!imageLoads.has(id)) imageObserver.observe(preview)
        }
      }, 200)
    }
  }

  async function refresh() {
    try {
      const [response, payload] = await requestJson('GET', '/api/media/images')
      if (!response.ok) {
        usageBars.hidden = true
        usageMessage.hidden = false
        usageMessage.textContent = 'Image usage unavailable.'
        setStatus(status, responseError(response, payload), true)
        return
      }
      images = payload.images
      for (const id of selectedIds) if (!images.some((image) => image.id === id)) selectedIds.delete(id)
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
  search.addEventListener('input', () => {
    if (sourceMode === 'online') searchOnline()
    else render()
  })
  for (const tab of sourceTabs) {
    tab.addEventListener('click', () => setSourceMode(tab.dataset.sourceTab))
  }
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || [])
    input.value = ''
    if (!files.length) return
    upload.disabled = true
    const uploaded = []
    const failures = []
    try {
      for (const [index, file] of files.entries()) {
        setStatus(status, `Uploading ${index + 1} of ${files.length}…`)
        if (file.size > MAX_IMAGE_BYTES) {
          failures.push(`${file.name}: image must be at most ${MAX_IMAGE_SIZE_LABEL}`)
          continue
        }
        try {
          const response = await fetch('/api/media/images', {
            method: 'POST', headers: {
              'Content-Type': 'application/octet-stream',
              'X-Image-Name': encodeURIComponent(file.name),
            }, body: file,
          })
          const payload = await response.json().catch(() => null)
          if (response.ok && Number.isInteger(payload?.id)) uploaded.push(payload.id)
          else failures.push(`${file.name}: ${responseError(response, payload)}`)
        } catch {
          failures.push(`${file.name}: could not upload`)
        }
      }
      if (!await refresh()) return
      if (onChooseMany) {
        for (const id of uploaded) selectedIds.add(id)
        updateMultiSelection()
        if (failures.length) setStatus(status, `${uploaded.length} ready. ${failures.slice(0, 3).join('; ')}`, true)
      } else if (uploaded.length && active?.isConnected) {
        setImage(active, uploaded[0])
        dialog.close()
      } else if (failures.length) {
        setStatus(status, failures.slice(0, 3).join('; '), true)
      }
    } catch {
      setStatus(status, 'Could not upload images.', true)
    } finally {
      upload.disabled = false
    }
  })
  addSelected.addEventListener('click', () => {
    if (!onChooseMany || !selectedIds.size) return
    const callback = onChooseMany
    const ids = images.filter((image) => selectedIds.has(image.id)).map((image) => image.id)
    dialog.close()
    onChooseMany = null
    callback(ids)
  })
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => {
    stopImageLoads()
    stopOnlineSearch()
  })
  render()
  return { createPicker, setImage, chooseMany }
}
