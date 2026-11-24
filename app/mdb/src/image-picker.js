import { createMediaPicker } from '@softerr/shared/media-picker.js'

export function createImagePicker({ page, requestJson, responseError, setStatus, notice, saveCell }) {
  const picker = createMediaPicker(page, { requestJson, responseError, setStatus })

  function openImageDialog(cell) {
    picker.openSingle((id) => {
      if (id === undefined) return
      if (!cell.button.isConnected) {
        notice.show('The table changed. Open the image picker again.', 'warning')
        return
      }
      const previous = cell.value
      cell.value = id
      saveCell(cell.button, cell.row.id, cell.column.id, id, previous,
        (old) => { cell.value = old }, (saved) => { cell.value = saved })
    }, cell.value)
  }

  return { openImageDialog }
}
