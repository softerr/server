export function createDeleteDialog({ page, endpoint, requestJson, responseError,
  setStatus, notice, pendingWrites, refresh, getRowsReady }) {
  const deleteDialog = page.querySelector('#mdb-delete-dialog')
  const deleteStatus = page.querySelector('#mdb-delete-status')
  const deleteUsage = page.querySelector('#mdb-delete-usage')
  const deleteUsageSummary = page.querySelector('#mdb-delete-usage-summary')
  const deleteUsageList = page.querySelector('#mdb-delete-usage-list')
  const deleteConfirm = page.querySelector('#mdb-delete-confirm')
  const deleteCancel = page.querySelector('#mdb-delete-cancel')
  let deletingItem = null
  let deleteUsageRequestId = 0
  let deletingInProgress = false

  function openDeleteDialog(kind, item) {
    deletingItem = { kind, id: item.id }
    const isColumn = kind === 'columns'
    page.querySelector('#mdb-delete-title').textContent = isColumn
      ? `Delete “${item.name}” column?` : `Delete row ${item.position}?`
    page.querySelector('#mdb-delete-description').textContent = isColumn
      ? 'This removes the column and all its values. Relations using it as a display column will use automatic labels.'
      : 'This removes all values in the row and clears links to it from relation columns.'
    deleteConfirm.textContent = isColumn ? 'Delete column' : 'Delete row'
    deleteConfirm.disabled = !isColumn
    deleteUsage.hidden = true
    deleteUsageSummary.textContent = ''
    deleteUsageList.replaceChildren()
    setStatus(deleteStatus, isColumn ? '' : 'Checking where this row is used…')
    deleteDialog.showModal()
    const requestId = ++deleteUsageRequestId
    if (!isColumn) void loadDeleteUsage(item.id, requestId)
  }

  async function loadDeleteUsage(rowId, requestId) {
    try {
      await Promise.all([...pendingWrites])
      const [response, payload] = await requestJson('GET', `${endpoint}/rows/${rowId}/usage`)
      if (!page.isConnected || !deleteDialog.open || requestId !== deleteUsageRequestId) return
      if (!response.ok) throw new Error(responseError(response, payload))
      if (!Array.isArray(payload?.uses)) throw new Error('Could not read row usage. Close and try again.')
      const uses = payload.uses
      deleteUsageSummary.textContent = uses.length === 0
        ? 'This row is not used in any relation cells.'
        : `Used in ${uses.length} relation cell${uses.length === 1 ? '' : 's'}:`
      for (const use of uses) {
        const entry = document.createElement('li')
        const database = document.createElement('strong')
        database.textContent = use.database_name
        const location = document.createElement('span')
        location.textContent = `Row ${use.row_position} · ${use.column_name}`
        entry.append(database, location)
        deleteUsageList.append(entry)
      }
      deleteConfirm.textContent = uses.length ? 'Delete anyway' : 'Delete row'
      deleteUsage.hidden = false
      deleteConfirm.disabled = false
      setStatus(deleteStatus, '')
    } catch (error) {
      if (page.isConnected && deleteDialog.open && requestId === deleteUsageRequestId) {
        setStatus(deleteStatus, error.message || 'Could not check row usage. Close and try again.', true)
      }
    }
  }

  deleteDialog.addEventListener('cancel', (event) => {
    if (deletingInProgress) event.preventDefault()
  })
  deleteCancel.addEventListener('click', () => deleteDialog.close())
  deleteDialog.addEventListener('close', () => {
    deletingItem = null
    deleteUsageRequestId += 1
  })
  deleteConfirm.addEventListener('click', async () => {
    if (!deletingItem || deleteConfirm.disabled) return
    const item = deletingItem
    deletingInProgress = true
    deleteConfirm.disabled = true
    deleteCancel.disabled = true
    setStatus(deleteStatus, `Deleting ${item.kind === 'columns' ? 'column' : 'row'}…`)
    try {
      if (item.kind === 'rows') await getRowsReady()
      await Promise.all([...pendingWrites])
      const [response, payload] = await requestJson('DELETE', `${endpoint}/${item.kind}/${item.id}`)
      if (!page.isConnected) return
      if (!response.ok) throw new Error(responseError(response, payload))
      deleteDialog.close()
      const label = item.kind === 'columns' ? 'Column' : 'Row'
      if (await refresh()) notice.show(`${label} deleted.`)
      else notice.show(`${label} deleted, but the table could not refresh.`, 'warning')
    } catch (error) {
      if (page.isConnected) setStatus(deleteStatus, error.message || 'Could not delete item.', true)
    } finally {
      deletingInProgress = false
      deleteConfirm.disabled = false
      deleteCancel.disabled = false
    }
  })
  return { openDeleteDialog }
}
