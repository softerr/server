import { createMediaPicker } from '@softerr/shared/media-picker.js'

export function mountArtworkPicker(page, { requestJson, responseError, onDelete }) {
  const picker = createMediaPicker(page, { requestJson, responseError, onDelete })
  return {
    open(selectedId = null) {
      return new Promise((resolve) => { picker.openSingle(resolve, selectedId) })
    },
  }
}
