import test from 'node:test'
import assert from 'node:assert/strict'
import { filterRowsByQuery } from '../../app/mdb/src/filter-rows.js'

const columns = [
  { id: 1, type: 'text' }, { id: 2, type: 'number' },
  { id: 3, type: 'checkbox' }, { id: 4, type: 'multi_select' },
  { id: 5, type: 'relation' }, { id: 6, type: 'multi_relation' },
]
const rows = [
  { id: 1, values: { 1: 'Star Wars', 2: '1977', 3: true, 4: ['Sci-Fi'], 5: 10, 6: [11] } },
  { id: 2, values: { 1: 'Arrival', 2: '2016', 4: ['Drama'], 5: 11, 6: [10] } },
]
const relationLabels = new Map([[10, 'Space'], [11, 'Earth']])
const labelsForColumn = (column) => [5, 6].includes(column.id) ? relationLabels : null
const ids = (query) => filterRowsByQuery(rows, columns, query, labelsForColumn).map((row) => row.id)

test('MDB row search matches text, numbers, choices, and displayed relations', () => {
  assert.deepEqual(ids('star'), [1])
  assert.deepEqual(ids('2016'), [2])
  assert.deepEqual(ids('SCI-FI'), [1])
  assert.deepEqual(ids('space'), [1, 2])
  assert.deepEqual(ids('earth'), [1, 2])
})

test('MDB row search handles checkboxes and an empty query', () => {
  assert.deepEqual(ids('yes'), [1])
  assert.deepEqual(ids('no'), [2])
  assert.deepEqual(ids('  '), [1, 2])
  assert.deepEqual(ids('missing'), [])
})
