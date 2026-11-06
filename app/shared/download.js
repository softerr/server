export function downloadBlob(blob, filename, revokeAfterMs = 1000) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  try { link.click() }
  finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs)
  }
}
