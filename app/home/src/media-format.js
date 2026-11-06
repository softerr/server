import { formatBytes } from '../../shared/format.js'

export { formatBytes }
export { imageIcon as mediaImageIcon } from '../../shared/icons.js'

export function formatImageDetails(image) {
  return `${image.width} × ${image.height} · ${formatBytes(image.size_bytes)}`
}
