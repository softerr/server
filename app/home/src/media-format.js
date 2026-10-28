export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1048576).toFixed(1)} MiB`
}

export function formatImageDetails(image) {
  return `${image.width} × ${image.height} · ${formatBytes(image.size_bytes)}`
}
