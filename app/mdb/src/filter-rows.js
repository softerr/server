function searchableCell(row, column, relationLabels) {
  const value = row.values?.[column.id]
  if (column.type === 'checkbox') return value === true ? 'yes' : 'no'
  if (value === null || value === undefined) return ''
  if (column.type === 'relation') return relationLabels ? relationLabels.get(value) ?? `Missing row ${value}` : ''
  if (column.type === 'multi_relation') {
    return relationLabels ? value.map((id) => relationLabels.get(id) ?? `Missing row ${id}`).join(' ') : ''
  }
  return Array.isArray(value) ? value.join(' ') : String(value)
}

export function filterRowsByQuery(rows, columns, query, labelsForColumn = () => null) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return rows
  return rows.filter((row) => columns.some((column) =>
    searchableCell(row, column, labelsForColumn(column)).toLocaleLowerCase().includes(needle)))
}
