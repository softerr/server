export function selectImageRange(event, imageId, visibleIds, selected, anchorId, grid) {
  const anchorIndex = visibleIds.indexOf(anchorId)
  const currentIndex = visibleIds.indexOf(imageId)
  const ids = event.shiftKey && anchorIndex !== -1 && currentIndex !== -1
    ? visibleIds.slice(Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex) + 1)
    : [imageId]

  for (const id of ids) {
    if (event.currentTarget.checked) selected.add(id)
    else selected.delete(id)
  }
  for (const checkbox of grid.querySelectorAll('[data-image-select]')) {
    checkbox.checked = selected.has(Number(checkbox.dataset.imageSelect))
  }
  return imageId
}
