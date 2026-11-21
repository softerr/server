import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextWheelRotation } from '../src/wheel.js'

test('each wheel segment lands under the pointer after repeated spins', () => {
  for (let count = 1; count <= 16; count++) {
    let rotation = 0
    for (let position = 0; position < count; position++) {
      const next = nextWheelRotation(rotation, position, count)
      const center = (position + 0.5) * 360 / count
      const offset = ((center + next) % 360 + 360) % 360
      assert.ok(Math.min(offset, 360 - offset) < 1e-8, `count ${count}, position ${position}`)
      assert.ok(next >= rotation + 360 * 5)
      rotation = next
    }
  }
})
