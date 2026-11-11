import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePastedDate } from '../src/date-parse.js'

test('MDB parses pasted ISO and named dates without shifting the calendar day', () => {
  assert.equal(parsePastedDate('2026-11-07'), '2026-11-07')
  assert.equal(parsePastedDate('2026/11/7'), '2026-11-07')
  assert.equal(parsePastedDate('2026-11-07T23:30:00-08:00'), '2026-11-07')
  assert.equal(parsePastedDate('Nov 7, 2026'), '2026-11-07')
  assert.equal(parsePastedDate('7 November 2026'), '2026-11-07')
})

test('MDB interprets ambiguous numeric dates using the browser locale', () => {
  assert.equal(parsePastedDate('03/04/2026', 'en-US'), '2026-03-04')
  assert.equal(parsePastedDate('03/04/2026', 'en-GB'), '2026-04-03')
  assert.equal(parsePastedDate('31.12.2026', 'en-US'), '2026-12-31')
  assert.equal(parsePastedDate('12/31/26', 'en-GB'), '2026-12-31')
})

test('MDB rejects invalid pasted dates instead of normalizing them', () => {
  assert.equal(parsePastedDate('2024-02-29'), '2024-02-29')
  for (const value of ['2023-02-29', '31/04/2026', '2026-13-01', '2026-11-07 extra', 'tomorrow']) {
    assert.equal(parsePastedDate(value), null)
  }
})
