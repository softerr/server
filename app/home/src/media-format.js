import { formatBytes } from '@softerr/shared/format.js'

export { formatBytes }
export { imageIcon as mediaImageIcon } from '@softerr/shared/icons.js'

export function formatImageDetails(image) {
  return `${image.width} × ${image.height} · ${formatBytes(image.size_bytes)}`
}
