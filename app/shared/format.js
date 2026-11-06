const UNITS = ['B', 'KiB', 'MiB', 'GiB']

export function formatBytes(bytes, { minimumUnit = 'B', roundUp = false } = {}) {
  const minimum = Math.max(0, UNITS.indexOf(minimumUnit))
  let unit = minimum
  while (unit < UNITS.length - 1 && bytes >= 1024 ** (unit + 1)) unit++
  const value = bytes / 1024 ** unit
  if (unit === 0) return `${bytes} B`
  return `${roundUp && unit === 1 ? Math.ceil(value) : value.toFixed(1)} ${UNITS[unit]}`
}
