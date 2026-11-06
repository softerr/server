import { formatBytes } from './format.js'

export function updateImageUsage(container, { usage, limits }) {
  container.querySelector('[data-image-count]').textContent = `${usage.count} / ${limits.count}`
  const countBar = container.querySelector('[data-image-count-bar]')
  countBar.max = limits.count
  countBar.value = usage.count
  container.querySelector('[data-image-storage]').textContent = `${formatBytes(usage.bytes)} / ${formatBytes(limits.bytes)}`
  const storageBar = container.querySelector('[data-image-storage-bar]')
  storageBar.max = limits.bytes
  storageBar.value = usage.bytes
  container.querySelector('[data-image-per-limit]').textContent = `${formatBytes(limits.per_image_bytes)} max per image`
}
