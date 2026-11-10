const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sortableValue(row, column, relationLabels) {
  const value = row.values?.[column.id]
  if (column.type === 'checkbox') return value === true ? 1 : 0
  if (value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0)) return null
  if (column.type === 'number') return Number(value)
  if (column.type === 'relation') return relationLabels.get(value) ?? String(value)
  if (column.type === 'multi_relation') {
    return value.map((id) => relationLabels.get(id) ?? String(id)).join(', ')
  }
  return Array.isArray(value) ? value.join(', ') : String(value)
}

export function sortRowsByColumn(rows, column, direction, relationLabels = new Map()) {
  const multiplier = direction === 'desc' ? -1 : 1
  return [...rows].sort((left, right) => {
    const a = sortableValue(left, column, relationLabels)
    const b = sortableValue(right, column, relationLabels)
    if (a === null || b === null) {
      if (a === null && b !== null) return 1
      if (b === null && a !== null) return -1
      return left.position - right.position
    }
    const comparison = typeof a === 'number' && typeof b === 'number'
      ? Math.sign(a - b) : collator.compare(a, b)
    return comparison * multiplier || left.position - right.position
  })
}
