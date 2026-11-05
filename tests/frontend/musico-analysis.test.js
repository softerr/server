import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateBpm, estimateKey } from '../../app/musico/src/music-theory.js'

function musicalBuffer({ bpm, chords, seconds = 20 }) {
  const sampleRate = 11025
  const samples = new Float32Array(sampleRate * seconds)
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate
    const beatTime = time % (60 / bpm)
    const notes = chords[Math.floor(time / 2) % chords.length]
    for (const frequency of notes) samples[i] += 0.05 * Math.sin(2 * Math.PI * frequency * time)
    if (beatTime < 0.012) samples[i] += 0.7 * Math.sin(2 * Math.PI * 1200 * beatTime)
      * Math.exp(-180 * beatTime)
  }
  return { sampleRate, getChannelData: () => samples }
}

test('estimates a steady beat and major key', () => {
  const audio = musicalBuffer({ bpm: 120, chords: [
    [261.63, 329.63, 392], [349.23, 440, 523.25],
    [392, 493.88, 587.33], [261.63, 329.63, 392],
  ] })
  assert.ok(Math.abs(estimateBpm(audio) - 120) <= 2)
  assert.equal(estimateKey(audio), 'C major')
})

test('estimates a slower beat and minor key', () => {
  const audio = musicalBuffer({ bpm: 90, chords: [
    [220, 261.63, 329.63], [293.66, 349.23, 440],
    [164.81, 196, 246.94], [220, 261.63, 329.63],
  ] })
  assert.ok(Math.abs(estimateBpm(audio) - 90) <= 2)
  assert.equal(estimateKey(audio), 'A minor')
})

test('does not invent rhythm or key for silence', () => {
  const audio = { sampleRate: 11025, getChannelData: () => new Float32Array(11025 * 5) }
  assert.equal(estimateBpm(audio), null)
  assert.equal(estimateKey(audio), null)
})
