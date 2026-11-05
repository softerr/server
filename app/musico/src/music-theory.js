const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function input(buffer) {
  const samples = buffer.getChannelData(0)
  const stride = Math.max(1, Math.round(buffer.sampleRate / 11025))
  return { samples, stride, rate: buffer.sampleRate / stride }
}

export function estimateBpm(buffer) {
  const { samples, stride, rate } = input(buffer)
  const frameSize = Math.max(1, Math.round(rate / 40))
  const frameCount = Math.min(Math.floor(samples.length / (frameSize * stride)), 24000)
  if (frameCount < 160) return null
  const energy = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0
    const start = frame * frameSize * stride
    for (let n = 0; n < frameSize; n++) {
      const value = samples[start + n * stride]
      sum += value * value
    }
    energy[frame] = Math.sqrt(sum / frameSize)
  }
  const onset = new Float32Array(frameCount)
  let strength = 0
  for (let i = 1; i < frameCount; i++) {
    onset[i] = Math.max(0, energy[i] - energy[i - 1])
    strength += onset[i] * onset[i]
  }
  if (strength < 1e-6) return null
  let bestBpm = null
  let bestScore = 0
  const scores = new Float32Array(201)
  const framesPerSecond = rate / frameSize
  for (let bpm = 60; bpm <= 200; bpm++) {
    const lag = framesPerSecond * 60 / bpm
    const integerLag = Math.floor(lag)
    const fraction = lag - integerLag
    let correlation = 0
    for (let i = integerLag + 1; i < frameCount; i++) {
      const previous = onset[i - integerLag] * (1 - fraction) + onset[i - integerLag - 1] * fraction
      correlation += onset[i] * previous
    }
    const normalized = correlation / strength
    const tempoPrior = 0.9 + 0.1 * Math.exp(-(((bpm - 120) / 60) ** 2))
    const score = normalized * tempoPrior
    scores[bpm] = score
    if (score > bestScore) { bestScore = score; bestBpm = bpm }
  }
  if (bestScore < 0.08) return null
  if (bestBpm < 100) {
    const center = bestBpm * 2
    let doubleTime = center
    for (let bpm = Math.max(60, center - 3); bpm <= Math.min(200, center + 3); bpm++) {
      if (scores[bpm] > scores[doubleTime]) doubleTime = bpm
    }
    if (scores[doubleTime] >= bestScore * 0.7) return doubleTime
  }
  return bestBpm
}

function fft(real, imaginary) {
  const size = real.length
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const oldReal = real[i]
      const oldImaginary = imaginary[i]
      real[i] = real[j]
      imaginary[i] = imaginary[j]
      real[j] = oldReal
      imaginary[j] = oldImaginary
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const half = length >> 1
    const angle = -2 * Math.PI / length
    const cosines = Float32Array.from({ length: half }, (_, offset) => Math.cos(angle * offset))
    const sines = Float32Array.from({ length: half }, (_, offset) => Math.sin(angle * offset))
    for (let start = 0; start < size; start += length) {
      for (let offset = 0; offset < half; offset++) {
        const right = start + offset + half
        const left = start + offset
        const transformedReal = real[right] * cosines[offset] - imaginary[right] * sines[offset]
        const transformedImaginary = real[right] * sines[offset] + imaginary[right] * cosines[offset]
        real[right] = real[left] - transformedReal
        imaginary[right] = imaginary[left] - transformedImaginary
        real[left] += transformedReal
        imaginary[left] += transformedImaginary
      }
    }
  }
}

function profileCorrelation(chroma, profile, tonic) {
  const chromaMean = chroma.reduce((sum, value) => sum + value, 0) / 12
  const profileMean = profile.reduce((sum, value) => sum + value, 0) / 12
  let product = 0
  let chromaSquared = 0
  let profileSquared = 0
  for (let i = 0; i < 12; i++) {
    const a = chroma[(i + tonic) % 12] - chromaMean
    const b = profile[i] - profileMean
    product += a * b
    chromaSquared += a * a
    profileSquared += b * b
  }
  return product / Math.sqrt(chromaSquared * profileSquared || 1)
}

export function estimateKey(buffer) {
  const { samples, stride, rate } = input(buffer)
  const size = 4096
  if (samples.length < size * stride) return null
  const frameCount = Math.min(128, Math.floor(samples.length / (size * stride)))
  const chroma = new Float64Array(12)
  let usefulFrames = 0
  const window = Float32Array.from({ length: size }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (size - 1)))
  const frequencyBins = []
  for (let bin = 1; bin < size / 2; bin++) {
    const frequency = bin * rate / size
    if (frequency < 80 || frequency > 1600) continue
    const note = Math.round(69 + 12 * Math.log2(frequency / 440))
    frequencyBins.push([bin, ((note % 12) + 12) % 12, 1 / Math.sqrt(frequency)])
  }
  for (let frame = 0; frame < frameCount; frame++) {
    const start = Math.floor(frame * (samples.length - size * stride) / Math.max(1, frameCount - 1))
    const real = new Float32Array(size)
    const imaginary = new Float32Array(size)
    for (let i = 0; i < size; i++) real[i] = samples[start + i * stride] * window[i]
    fft(real, imaginary)
    const frameChroma = new Float64Array(12)
    let total = 0
    for (const [bin, note, weight] of frequencyBins) {
      const magnitude = Math.hypot(real[bin], imaginary[bin]) * weight
      frameChroma[note] += magnitude
      total += magnitude
    }
    if (total < 0.01) continue
    for (let note = 0; note < 12; note++) chroma[note] += frameChroma[note] / total
    usefulFrames++
  }
  if (usefulFrames < 4) return null
  let best = { score: -Infinity, label: null }
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
      const score = profileCorrelation(chroma, profile, tonic)
      if (score > best.score) best = { score, label: `${NOTES[tonic]} ${mode}` }
    }
  }
  return best.score >= 0.25 ? best.label : null
}

export function estimateTempoAndKey(buffer) {
  return { bpm: estimateBpm(buffer), key: estimateKey(buffer) }
}
