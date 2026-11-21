export function matchesMediaFolder(image, folder) {
  if (folder === 'all') return true
  if (folder === 'personal') return image.scope === 'personal'
  if (folder === 'shared') return image.scope === 'shared'
  if (folder === 'ungrouped') return image.scope === 'shared' && image.group_id === null
  const match = /^group:([1-9][0-9]*)$/.exec(folder)
  return Boolean(match && image.scope === 'shared' && image.group_id === Number(match[1]))
}

export function updateMediaFolderOptions(select, groups) {
  const previous = select.value || 'all'
  const options = [
    ['all', 'All images'],
    ['personal', 'My images'],
    ['shared', 'All shared images'],
    ['ungrouped', 'Shared · Ungrouped'],
    ...[...groups].sort((a, b) => a.name.localeCompare(b.name))
      .map((group) => [`group:${group.id}`, `Shared · ${group.name}`]),
  ]
  select.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    return option
  }))
  select.value = options.some(([value]) => value === previous) ? previous : 'all'
}
