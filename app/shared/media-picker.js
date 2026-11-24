import { noImageIcon, pasteImageIcon, previewImageIcon, removeIcon, uploadImageIcon } from './icons.js'
import { listMediaGroups, listMediaImages, mediaImageUrl, uploadMediaImage } from './media-client.js'
import { matchesMediaFolder, updateMediaFolderOptions } from './media-folder-filter.js'
import { createMediaThumbnailBatcher } from './media-thumbnails.js'
import { updateImageUsage } from './image-usage.js'
import { formatBytes } from './format.js'

const imageUrl = mediaImageUrl

function setPickerStatus(element, message, error = false, success = false) {
  element.textContent = message
  element.classList.toggle('error', error)
  element.classList.toggle('success', success)
}

function imageUploadName(file, index) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[file.type] || 'png'
  return file.name || `Pasted image ${index + 1}.${extension}`
}

function isSupportedImage(file) {
  return /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)
    || (!file.type && /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || ''))
}

export function createMediaPicker(section, { requestJson, responseError, setStatus = setPickerStatus,
  onDelete = () => {}, onImages = () => {} }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'image-library-dialog'
  dialog.innerHTML = `
    <div class="image-library-heading">
      <h2>Choose image</h2>
      <div class="image-library-tabs" aria-label="Image source">
        <button type="button" data-source-tab="local" aria-pressed="true">My library</button>
        <button type="button" data-source-tab="online" aria-pressed="false">Online</button>
      </div>
      <button type="button" class="image-library-close" data-close aria-label="Close image picker" title="Close">${removeIcon}</button>
    </div>
    <p data-library-description hidden></p>
    <input type="file" data-image-upload-input accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" multiple hidden>
    <div class="image-library-controls">
      <div class="image-library-filters">
        <label class="field image-library-search">
          <span data-search-label>Search images</span>
          <input type="search" data-image-search placeholder="Search by name" autocomplete="off">
        </label>
        <label class="field image-library-folder-filter">
          <span>Folder</span>
          <select data-image-folder aria-label="Filter images by folder"><option value="all">All images</option></select>
        </label>
      </div>
      <div class="image-library-toolbar">
        <button type="button" class="auth-button auth-button-secondary" data-upload aria-label="Upload image" title="Upload image">${uploadImageIcon}</button>
        <button type="button" class="auth-button auth-button-secondary" data-paste aria-label="Paste from clipboard" title="Paste from clipboard">${pasteImageIcon}</button>
        <button type="button" class="auth-button auth-button-secondary" data-no-image aria-label="No image" title="No image">${noImageIcon}</button>
      </div>
    </div>
    <div class="image-library-grid"></div>
    <div class="image-library-footer">
      <p class="form-status" role="status" aria-live="polite"></p>
      <div class="image-library-footer-row">
        <details class="image-library-usage">
          <summary><span data-usage-summary aria-live="polite">Loading image limits…</span><span class="image-library-usage-toggle">Usage details</span></summary>
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
        </details>
        <div class="image-library-multi-actions" hidden>
          <span>Choose several images; empty rows are filled first.</span>
          <button type="button" class="auth-button auth-button-primary" data-add-selected disabled>Add images</button>
        </div>
      </div>
    </div>
    <div class="image-library-drop-overlay" data-drop-overlay hidden>Drop images to preview</div>
  `
  const previewDialog = document.createElement('dialog')
  previewDialog.className = 'image-library-preview-dialog'
  previewDialog.setAttribute('aria-label', 'Image preview')
  previewDialog.innerHTML = `
    <div class="image-library-preview-heading">
      <h2 data-preview-name></h2>
      <button type="button" class="image-library-close" data-preview-close aria-label="Close image preview" title="Close">${removeIcon}</button>
    </div>
    <div class="image-library-preview-stage"><img data-preview-image alt=""></div>
    <div class="image-library-preview-navigation" data-preview-navigation hidden>
      <button type="button" data-preview-previous aria-label="Previous image">‹</button>
      <span data-preview-position></span>
      <button type="button" data-preview-next aria-label="Next image">›</button>
    </div>
    <p data-preview-details></p>
    <a data-preview-source target="_blank" rel="noopener noreferrer" hidden>Source and license</a>
    <p class="form-status" data-preview-status role="status" aria-live="polite"></p>
    <div class="image-library-preview-actions">
      <button type="button" class="auth-button auth-button-secondary image-library-delete" data-preview-delete hidden>Delete image</button>
      <button type="button" class="auth-button auth-button-secondary" data-preview-cancel hidden>Cancel</button>
      <button type="button" class="auth-button auth-button-primary" data-preview-use>Use image</button>
    </div>
    <div class="image-library-drop-overlay" data-preview-drop-overlay hidden>Drop images to preview</div>
  `
  section.append(dialog, previewDialog)
  const input = dialog.querySelector('[data-image-upload-input]')
  const grid = dialog.querySelector('.image-library-grid')
  const dropOverlay = dialog.querySelector('[data-drop-overlay]')
  const usage = dialog.querySelector('.image-library-usage')
  const usageBars = usage.querySelector('.image-library-usage-bars')
  const usageSummary = usage.querySelector('[data-usage-summary]')
  const search = dialog.querySelector('[data-image-search]')
  const filters = dialog.querySelector('.image-library-filters')
  const folderFilter = dialog.querySelector('.image-library-folder-filter')
  const folderSelect = dialog.querySelector('[data-image-folder]')
  const searchLabel = dialog.querySelector('[data-search-label]')
  const description = dialog.querySelector('[data-library-description]')
  const sourceTabs = dialog.querySelectorAll('[data-source-tab]')
  const status = dialog.querySelector('.form-status')
  const upload = dialog.querySelector('[data-upload]')
  const paste = dialog.querySelector('[data-paste]')
  const noImage = dialog.querySelector('[data-no-image]')
  const multiActions = dialog.querySelector('.image-library-multi-actions')
  const addSelected = dialog.querySelector('[data-add-selected]')
  const previewName = previewDialog.querySelector('[data-preview-name]')
  const previewImage = previewDialog.querySelector('[data-preview-image]')
  const previewNavigation = previewDialog.querySelector('[data-preview-navigation]')
  const previewPrevious = previewDialog.querySelector('[data-preview-previous]')
  const previewNext = previewDialog.querySelector('[data-preview-next]')
  const previewPosition = previewDialog.querySelector('[data-preview-position]')
  const previewDetails = previewDialog.querySelector('[data-preview-details]')
  const previewSource = previewDialog.querySelector('[data-preview-source]')
  const previewStatus = previewDialog.querySelector('[data-preview-status]')
  const previewDelete = previewDialog.querySelector('[data-preview-delete]')
  const previewCancel = previewDialog.querySelector('[data-preview-cancel]')
  const previewUse = previewDialog.querySelector('[data-preview-use]')
  const previewDropOverlay = previewDialog.querySelector('[data-preview-drop-overlay]')
  let images = []
  let onChoose = null
  let onChooseMany = null
  let selectedId = null
  let selectionAnchor = null
  const selectedIds = new Set()
  const imageLoads = new Map()
  const visiblePreviews = new Map()
  let loadTimer = null
  let sourceMode = 'local'
  const searchTerms = { local: '', online: '' }
  let onlineResults = []
  let onlineSearchTimer = null
  let onlineSearchController = null
  let uploading = false
  let dialogVersion = 0
  let previewVersion = 0
  let previewObjectUrls = []
  const batcher = createMediaThumbnailBatcher({
    isActive: () => dialog.open,
    onResult(id, url) {
      const load = imageLoads.get(id)
      if (!load) return
      load.url = url
      const preview = visiblePreviews.get(id)
      if (preview) preview.src = url
    },
  })
  const imageObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      imageObserver.unobserve(entry.target)
      const id = Number(entry.target.dataset.libraryPreviewId)
      if (imageLoads.has(id)) continue
      imageLoads.set(id, { url: null })
      batcher.enqueue(id)
    }
  }, { root: grid, rootMargin: '80px' }) : null

  function stopImageLoads() {
    clearTimeout(loadTimer)
    imageObserver?.disconnect()
    batcher.clear()
    imageLoads.clear()
    visiblePreviews.clear()
  }

  function stopOnlineSearch() {
    clearTimeout(onlineSearchTimer)
    onlineSearchController?.abort()
    onlineSearchController = null
  }

  function clearPreviewObjectUrls() {
    for (const url of previewObjectUrls) URL.revokeObjectURL(url)
    previewObjectUrls = []
  }

  function showPreview({ name, src, details, source, sourceLabel = 'Source and license',
    sourceTitle = '', action = 'Use image', onUse, deletableImage = null,
    cancel = false, objectUrls = [] }) {
    previewVersion++
    clearPreviewObjectUrls()
    previewObjectUrls = objectUrls
    previewName.textContent = name
    previewImage.src = src
    previewDetails.textContent = details
    setStatus(previewStatus, '')
    previewSource.hidden = !source
    if (source) previewSource.href = source
    else previewSource.removeAttribute('href')
    previewSource.textContent = sourceLabel
    previewSource.title = sourceTitle
    previewUse.textContent = action
    previewUse.disabled = false
    previewUse.onclick = () => {
      previewDialog.close()
      onUse()
    }
    previewNavigation.hidden = true
    previewPrevious.onclick = null
    previewNext.onclick = null
    previewDelete.hidden = !deletableImage
    previewDelete.disabled = false
    previewDelete.onclick = deletableImage ? () => deleteImage(deletableImage) : null
    previewCancel.hidden = !cancel
    if (!previewDialog.open) previewDialog.showModal()
  }

  function showPendingImagePreview(files, source = 'From clipboard', skipped = 0) {
    if (!files.length || !dialog.open) return
    const urls = []
    try {
      for (const file of files) urls.push(URL.createObjectURL(file))
    } catch {
      for (const url of urls) URL.revokeObjectURL(url)
      setStatus(status, 'Could not preview images.', true)
      return
    }
    setStatus(status, '')
    let index = 0
    showPreview({
      name: imageUploadName(files[0], 0), src: urls[0],
      details: `${source} · ${formatBytes(files[0].size)}`,
      action: files.length === 1 ? 'Upload image' : `Upload ${files.length} images`,
      cancel: true, objectUrls: urls,
      onUse: () => { void uploadFiles(files) },
    })
    if (skipped) setStatus(previewStatus, `${skipped} unsupported file${skipped === 1 ? '' : 's'} skipped.`, true)
    previewNavigation.hidden = files.length < 2
    const showIndex = (next) => {
      index = next
      previewName.textContent = imageUploadName(files[index], index)
      previewImage.src = urls[index]
      previewDetails.textContent = `${source} · ${formatBytes(files[index].size)}`
      previewPosition.textContent = `${index + 1} / ${files.length}`
      previewPrevious.disabled = index === 0
      previewNext.disabled = index === files.length - 1
    }
    previewPrevious.onclick = () => showIndex(index - 1)
    previewNext.onclick = () => showIndex(index + 1)
    showIndex(0)
  }

  function bindImageDrop(target, overlay) {
    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')
      || Boolean(event.dataTransfer?.files?.length)
    const hideOverlay = () => { overlay.hidden = true }
    target.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      overlay.hidden = false
    })
    target.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      overlay.hidden = false
    })
    target.addEventListener('dragleave', (event) => {
      if (overlay.hidden) return
      const bounds = target.getBoundingClientRect()
      if (event.clientX >= bounds.left && event.clientX < bounds.right
        && event.clientY >= bounds.top && event.clientY < bounds.bottom) return
      hideOverlay()
    })
    target.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      hideOverlay()
      const message = target === previewDialog ? previewStatus : status
      if (uploading) {
        setStatus(message, 'An image upload is already in progress.')
        return
      }
      const files = Array.from(event.dataTransfer.files || [])
      const supported = files.filter(isSupportedImage)
      if (!supported.length) {
        setStatus(message, 'Drop PNG, JPEG, WebP, GIF, or SVG images.', true)
        return
      }
      showPendingImagePreview(supported, 'Dropped file', files.length - supported.length)
    })
    target.addEventListener('close', hideOverlay)
  }

  async function deleteImage(image) {
    if (!window.confirm('Delete this image from your library?')) return
    const version = dialogVersion
    const currentPreview = previewVersion
    previewDelete.disabled = true
    previewUse.disabled = true
    setStatus(previewStatus, 'Deleting image…')
    try {
      const [response, payload] = await requestJson('DELETE', imageUrl(image.id))
      if (!dialog.open || version !== dialogVersion) return
      if (!response.ok) {
        setStatus(previewDialog.open && currentPreview === previewVersion ? previewStatus : status,
          responseError(response, payload), true)
        return
      }
      if (previewDialog.open && currentPreview === previewVersion) previewDialog.close()
      onDelete(image.id)
      images = images.filter((item) => item.id !== image.id)
      selectedIds.delete(image.id)
      if (selectedId === image.id) selectedId = null
      render()
      if (await refresh()) setStatus(status, 'Image deleted.', false, true)
    } catch {
      if (dialog.open && version === dialogVersion) {
        setStatus(previewDialog.open && currentPreview === previewVersion ? previewStatus : status,
          'Could not delete image.', true)
      }
    } finally {
      if (currentPreview === previewVersion) {
        previewDelete.disabled = false
        previewUse.disabled = false
      }
    }
  }

  function addPreviewButton(tile, name, onPreview) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'image-library-preview-button'
    button.setAttribute('aria-label', `Preview ${name}`)
    button.title = `Preview ${name}`
    button.innerHTML = previewImageIcon
    button.addEventListener('click', onPreview)
    tile.append(button)
  }

  function updateNoImageAction() {
    noImage.hidden = Boolean(onChooseMany)
    noImage.classList.toggle('is-selected', !onChooseMany && selectedId === null)
    if (!onChooseMany) noImage.setAttribute('aria-pressed', String(selectedId === null))
    else noImage.removeAttribute('aria-pressed')
  }

  function setSourceMode(mode) {
    stopOnlineSearch()
    if (mode === 'online') stopImageLoads()
    searchTerms[sourceMode] = search.value
    sourceMode = mode
    onlineResults = []
    search.value = searchTerms[mode]
    folderFilter.hidden = mode === 'online'
    filters.classList.toggle('is-online', mode === 'online')
    searchLabel.textContent = mode === 'online' ? 'Search Wikimedia Commons' : 'Search images'
    search.placeholder = mode === 'online' ? 'Enter at least two characters' : 'Search by name'
    description.hidden = mode !== 'online'
    description.textContent = mode === 'online'
      ? 'Select an image to save it to your uploads. Check its source and license before using it.' : ''
    for (const tab of sourceTabs) tab.setAttribute('aria-pressed', String(tab.dataset.sourceTab === mode))
    multiActions.hidden = mode === 'online' || !onChooseMany
    updateNoImageAction()
    setStatus(status, '')
    render()
    if (dialog.open && mode === 'online') searchOnline()
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
        const version = dialogVersion
        choose.disabled = true
        setStatus(status, `Importing ${result.name}…`)
        try {
          const [response, image] = await requestJson('POST', '/api/media/images/import', { id: result.id })
          if (!dialog.open || version !== dialogVersion) return
          if (!response.ok) {
            setStatus(status, responseError(response, image), true)
            return
          }
          setSourceMode('local')
          folderSelect.value = 'all'
          search.value = ''
          searchTerms.local = ''
          if (!await refresh()) return
          if (onChooseMany) {
            selectedIds.add(image.id)
            updateMultiSelection()
            setStatus(status, 'Image added to your library.', false, true)
          } else chooseImage(image.id)
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
      tile.append(choose, name)
      addPreviewButton(tile, result.name, () => showPreview({
        name: result.name, src: result.thumbnail_url,
        details: 'Wikimedia Commons preview', source: result.source_page,
        action: 'Import image', onUse: () => choose.click(),
      }))
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

  async function openLibrary(callback = null, many = null, currentId = null) {
    dialogVersion++
    onChoose = callback
    onChooseMany = many
    selectedId = currentId
    selectedIds.clear()
    selectionAnchor = null
    multiActions.hidden = !many
    input.multiple = Boolean(many)
    upload.setAttribute('aria-label', many ? 'Upload images' : 'Upload image')
    upload.title = many ? 'Upload images' : 'Upload image'
    dialog.querySelector('.image-library-heading h2').textContent = many ? 'Choose images' : 'Choose image'
    dialog.setAttribute('aria-label', many ? 'Choose images' : 'Choose image')
    setSourceMode(sourceMode)
    setStatus(status, 'Loading images…')
    dialog.showModal()
    await refresh()
    if (dialog.open && sourceMode === 'online') searchOnline()
  }

  function chooseImage(id) {
    const callback = onChoose
    onChoose = null
    dialog.close()
    callback?.(id)
  }

  function render(deferPreviews = false) {
    if (sourceMode === 'online') {
      renderOnline()
      return
    }
    const query = search.value.trim().toLocaleLowerCase()
    const visibleImages = images.filter((image) => matchesMediaFolder(image, folderSelect.value)
      && (!query || image.name.toLocaleLowerCase().includes(query)))
    const visibleIds = new Set(visibleImages.map((image) => image.id))
    clearTimeout(loadTimer)
    imageObserver?.disconnect()
    visiblePreviews.clear()
    batcher.retain(visibleIds)
    for (const id of imageLoads.keys()) {
      if (visibleIds.has(id)) continue
      imageLoads.delete(id)
    }
    updateNoImageAction()
    grid.replaceChildren()
    for (const scope of ['personal', 'shared']) {
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
        choose.classList.toggle('is-selected', !onChooseMany && image.id === selectedId)
        if (!onChooseMany) choose.setAttribute('aria-pressed', String(image.id === selectedId))
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
          chooseImage(image.id)
        })
        const name = document.createElement('span')
        name.className = 'image-library-name'
        name.textContent = image.name
        name.title = image.name
        tile.append(choose, name)
        addPreviewButton(tile, image.name, () => {
          const details = [image.scope === 'shared' ? 'Shared image' : 'My image']
          if (Number(image.width) > 0 && Number(image.height) > 0) {
            details.push(`${image.width} × ${image.height}`)
          }
          if (Number(image.size_bytes) > 0) details.push(formatBytes(image.size_bytes))
          showPreview({
            name: image.name, src: imageUrl(image.id), details: details.join(' · '),
            source: image.source?.page,
            sourceLabel: image.source?.license || 'Source and license',
            sourceTitle: image.source?.attribution || image.source?.creator || '',
            action: onChooseMany && selectedIds.has(image.id) ? 'Unselect image'
              : onChooseMany ? 'Select image' : 'Use image',
            onUse: () => choose.click(),
            deletableImage: scope === 'personal' ? image : null,
          })
        })
        grid.append(tile)
      }
    }
    if (!visibleImages.length) {
      const noResults = document.createElement('p')
      noResults.className = 'image-library-no-results'
      noResults.textContent = query ? 'No images match your search.'
        : folderSelect.value === 'all' ? 'No images available.' : 'No images in this folder.'
      grid.append(noResults)
    }
    updateMultiSelection()
    if (dialog.open) {
      const observePreviews = () => {
        for (const [id, preview] of visiblePreviews) {
          if (imageLoads.has(id)) continue
          if (imageObserver) imageObserver.observe(preview)
          else {
            imageLoads.set(id, { url: null })
            batcher.enqueue(id)
          }
        }
      }
      if (deferPreviews) loadTimer = setTimeout(observePreviews, 100)
      else observePreviews()
    }
  }

  async function refresh() {
    const version = dialogVersion
    try {
      const [[response, payload], [groupResponse, groupPayload]] = await Promise.all([
        listMediaImages(requestJson), listMediaGroups(requestJson).catch(() => [null, null]),
      ])
      if (!dialog.open || version !== dialogVersion) return false
      if (!response.ok) {
        usageBars.hidden = true
        usageSummary.textContent = 'Image usage unavailable.'
        setStatus(status, responseError(response, payload), true)
        return
      }
      images = [...payload.images].sort((a, b) => {
        if (a.scope !== b.scope) return a.scope === 'personal' ? -1 : 1
        return a.scope === 'personal' ? b.id - a.id : 0
      })
      onImages(images)
      if (groupResponse?.ok && Array.isArray(groupPayload?.groups)) {
        updateMediaFolderOptions(folderSelect, groupPayload.groups)
      }
      for (const id of selectedIds) if (!images.some((image) => image.id === id)) selectedIds.delete(id)
      updateImageUsage(usage, payload)
      usageBars.hidden = false
      usageSummary.textContent = `${payload.usage.count} / ${payload.limits.count} images · ${formatBytes(payload.usage.bytes)} / ${formatBytes(payload.limits.bytes)}`
      render()
      setStatus(status, '')
      return true
    } catch {
      if (!dialog.open || version !== dialogVersion) return false
      usageBars.hidden = true
      usageSummary.textContent = 'Image usage unavailable.'
      setStatus(status, 'Could not load images.', true)
    }
    return false
  }

  upload.addEventListener('click', () => input.click())
  noImage.addEventListener('click', () => {
    if (!onChooseMany) chooseImage(null)
  })
  search.addEventListener('input', () => {
    if (sourceMode === 'online') searchOnline()
    else render(true)
  })
  folderSelect.addEventListener('change', () => {
    selectionAnchor = null
    render()
  })
  for (const tab of sourceTabs) {
    tab.addEventListener('click', () => setSourceMode(tab.dataset.sourceTab))
  }
  async function uploadFiles(files) {
    if (!files.length || uploading) return
    const version = dialogVersion
    uploading = true
    upload.disabled = true
    const uploaded = []
    const failures = []
    try {
      for (const [index, file] of files.entries()) {
        const name = imageUploadName(file, index)
        if (dialog.open && version === dialogVersion) setStatus(status, `Uploading ${index + 1} of ${files.length}…`)
        try {
          const [response, payload] = await uploadMediaImage(file, name)
          if (response.ok && Number.isInteger(payload?.id)) uploaded.push(payload.id)
          else failures.push(`${name}: ${responseError(response, payload)}`)
        } catch (error) {
          failures.push(`${name}: ${error instanceof RangeError ? error.message : 'could not upload'}`)
        }
      }
      if (!dialog.open || version !== dialogVersion) return
      if (uploaded.length) {
        if (sourceMode !== 'local') setSourceMode('local')
        folderSelect.value = 'all'
        search.value = ''
        searchTerms.local = ''
      }
      if (!await refresh()) return
      if (onChooseMany) {
        for (const id of uploaded) selectedIds.add(id)
        updateMultiSelection()
        if (failures.length) setStatus(status, `${uploaded.length} ready. ${failures.slice(0, 3).join('; ')}`, true)
      } else if (uploaded.length) {
        chooseImage(uploaded[0])
      } else if (failures.length) {
        setStatus(status, failures.slice(0, 3).join('; '), true)
      }
    } catch {
      if (dialog.open && version === dialogVersion) setStatus(status, 'Could not upload images.', true)
    } finally {
      uploading = false
      upload.disabled = false
    }
  }
  paste.addEventListener('click', async () => {
    if (uploading) {
      setStatus(status, 'An image upload is already in progress.')
      return
    }
    if (!navigator.clipboard?.read) {
      setStatus(status, 'Clipboard access is unavailable. Use Ctrl+V or ⌘V in this picker.', true)
      return
    }
    const version = dialogVersion
    paste.disabled = true
    setStatus(status, 'Reading clipboard…')
    try {
      const items = await navigator.clipboard.read()
      const files = []
      for (const item of items) {
        const type = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].find((format) => item.types.includes(format))
        if (type) files.push(await item.getType(type))
      }
      if (!dialog.open || version !== dialogVersion) return
      if (!files.length) {
        setStatus(status, 'Clipboard has no PNG, JPEG, WebP, GIF, or SVG image.', true)
      } else if (uploading) {
        setStatus(status, 'An image upload is already in progress.')
      } else {
        showPendingImagePreview(files)
      }
    } catch (error) {
      if (dialog.open && version === dialogVersion) {
        setStatus(status, error?.name === 'NotAllowedError'
          ? 'Clipboard access was denied. Use Ctrl+V or ⌘V in this picker.'
          : 'Could not read an image from the clipboard.', true)
      }
    } finally {
      paste.disabled = false
    }
  })
  input.addEventListener('change', () => {
    const files = Array.from(input.files || [])
    input.value = ''
    void uploadFiles(files)
  })
  function handlePaste(event) {
    const clipboardItems = Array.from(event.clipboardData?.items || [])
    const itemFiles = clipboardItems
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean)
    const files = itemFiles.length ? itemFiles : Array.from(event.clipboardData?.files || [])
    const images = files.filter((file) => file.type.startsWith('image/'))
    const svgText = clipboardItems.find((item) => item.kind === 'string' && item.type === 'image/svg+xml')
    if (!images.length && !svgText) return
    event.preventDefault()
    const supported = images.filter(isSupportedImage)
    if (!supported.length && !svgText) {
      setStatus(status, 'Paste a PNG, JPEG, WebP, GIF, or SVG image.', true)
      return
    }
    if (uploading) {
      setStatus(status, 'An image upload is already in progress.')
      return
    }
    const svgFiles = supported.filter((file) => file.type === 'image/svg+xml')
    if (svgFiles.length) {
      showPendingImagePreview(svgFiles)
    } else if (svgText) {
      const version = dialogVersion
      const inPreview = event.currentTarget === previewDialog
      svgText.getAsString((source) => {
        if (!dialog.open || version !== dialogVersion || (inPreview && !previewDialog.open)) return
        if (source) showPendingImagePreview([new File([source], 'Pasted image.svg', { type: 'image/svg+xml' })])
        else setStatus(status, 'Could not read SVG from the clipboard.', true)
      })
    } else {
      showPendingImagePreview(supported)
    }
  }
  dialog.addEventListener('paste', handlePaste)
  previewDialog.addEventListener('paste', handlePaste)
  addSelected.addEventListener('click', () => {
    if (!onChooseMany || !selectedIds.size) return
    const callback = onChooseMany
    const ids = images.filter((image) => selectedIds.has(image.id)).map((image) => image.id)
    dialog.close()
    onChooseMany = null
    callback(ids)
  })
  previewDialog.querySelector('[data-preview-close]').addEventListener('click', () => previewDialog.close())
  bindImageDrop(dialog, dropOverlay)
  bindImageDrop(previewDialog, previewDropOverlay)
  previewCancel.addEventListener('click', () => previewDialog.close())
  previewDialog.addEventListener('keydown', (event) => {
    if (previewNavigation.hidden) return
    if (event.key === 'ArrowLeft' && !previewPrevious.disabled) {
      event.preventDefault()
      previewPrevious.click()
    } else if (event.key === 'ArrowRight' && !previewNext.disabled) {
      event.preventDefault()
      previewNext.click()
    }
  })
  previewDialog.addEventListener('close', () => {
    if (previewDialog.open) return
    previewImage.removeAttribute('src')
    clearPreviewObjectUrls()
    previewUse.onclick = null
    previewDelete.onclick = null
    previewPrevious.onclick = null
    previewNext.onclick = null
  })
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => {
    if (dialog.open) return
    if (previewDialog.open) previewDialog.close()
    stopImageLoads()
    stopOnlineSearch()
    const callback = onChoose
    onChoose = null
    onChooseMany = null
    callback?.(undefined)
  })
  render()
  return {
    openSingle: (callback, currentId = null) => openLibrary(callback, null, currentId),
    openMany: (callback) => openLibrary(null, callback),
  }
}
