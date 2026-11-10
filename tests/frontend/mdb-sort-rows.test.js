import test from 'node:test'
import assert from 'node:assert/strict'
import { sortRowsByColumn } from '../../app/mdb/src/sort-rows.js'

const rows = [
  { id: 1, position: 1, values: { 7: '10', 8: 'Beta', 9: true, 10: 4 } },
  { id: 2, position: 2, values: { 7: '2', 8: 'alpha', 10: 3 } },
  { id: 3, position: 3, values: { 7: '-3', 8: 'Alpha', 9: true, 10: 5 } },
  { id: 4, position: 4, values: {} },
]

function ids(column, direction, labels) {
  return sortRowsByColumn(rows, column, direction, labels).map((row) => row.id)
}

test('MDB sorts numbers numerically and keeps empty values last', () => {
  assert.deepEqual(ids({ id: 7, type: 'number' }, 'asc'), [3, 2, 1, 4])
  assert.deepEqual(ids({ id: 7, type: 'number' }, 'desc'), [1, 2, 3, 4])
})

test('MDB sorts text naturally and preserves saved order for equal values', () => {
  assert.deepEqual(ids({ id: 8, type: 'text' }, 'asc'), [2, 3, 1, 4])
  assert.deepEqual(ids({ id: 8, type: 'text' }, 'desc'), [1, 2, 3, 4])
})

test('MDB sorts checkboxes and relation cells by their displayed labels', () => {
  assert.deepEqual(ids({ id: 9, type: 'checkbox' }, 'asc'), [2, 4, 1, 3])
  const labels = new Map([[3, 'Zebra'], [4, 'Apple'], [5, 'Berry']])
  assert.deepEqual(ids({ id: 10, type: 'relation' }, 'asc', labels), [1, 3, 2, 4])
})

test('MDB sorts dates and multi-select values with empty cells last', () => {
  const values = [
    { id: 1, position: 1, values: { 11: '2026-11-02', 12: ['Zebra'] } },
    { id: 2, position: 2, values: { 11: '2025-01-10', 12: ['Apple', 'Pear'] } },
    { id: 3, position: 3, values: {} },
  ]
  assert.deepEqual(sortRowsByColumn(values, { id: 11, type: 'date' }, 'asc').map((row) => row.id), [2, 1, 3])
  assert.deepEqual(sortRowsByColumn(values, { id: 12, type: 'multi_select' }, 'desc').map((row) => row.id), [1, 2, 3])
})
