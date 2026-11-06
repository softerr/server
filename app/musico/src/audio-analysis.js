function accent() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d08b38'
}

export function drawSpectrogram(buffer, canvas, maxFrequencyHz = Math.min(22050, buffer.sampleRate / 2)) {
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.min(1600, Math.max(640, Math.ceil(canvas.clientWidth * scale)))
  canvas.height = Math.min(720, Math.max(300, Math.ceil(canvas.clientHeight * scale)))
  const { width, height } = canvas
  const samples = buffer.getChannelData(0)
  const spectrum = canvas.getContext('2d')
  const image = spectrum.createImageData(width, height)
  const size = 2048
  const half = size / 2
  const bitCount = Math.log2(size)
  const hann = Float32Array.from({ length: size }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (size - 1)))
  const reverse = new Uint16Array(size)
  for (let n = 0; n < size; n++) {
    let bits = n
    for (let shift = 0; shift < bitCount; shift++) {
      reverse[n] = (reverse[n] << 1) | (bits & 1)
      bits >>= 1
    }
  }
  const stages = []
  for (let length = 2; length <= size; length *= 2) {
    const cosine = new Float32Array(length / 2)
    const sine = new Float32Array(length / 2)
    for (let n = 0; n < length / 2; n++) {
      const angle = -2 * Math.PI * n / length
      cosine[n] = Math.cos(angle)
      sine[n] = Math.sin(angle)
    }
    stages.push({ length, cosine, sine })
  }
  const maxBin = Math.min(half - 1, Math.floor(maxFrequencyHz * size / buffer.sampleRate))
  const bins = Float32Array.from({ length: height }, (_, row) =>
    (height - 1 - row) / height * maxBin)
  const color = /^#[\da-f]{6}$/i.test(accent()) ? accent() : '#d08b38'
  const middle = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
  const dark = [18, 18, 18]
  const light = [235, 235, 235]
  const real = new Float32Array(size)
  const imaginary = new Float32Array(size)
  const magnitudes = new Float32Array(half)

  for (let x = 0; x < width; x++) {
    const start = Math.max(0, Math.min(samples.length - size,
      Math.floor((x + 0.5) * samples.length / width - half)))
    for (let n = 0; n < size; n++) {
      real[reverse[n]] = (samples[start + n] ?? 0) * hann[n]
      imaginary[n] = 0
    }
    for (const { length, cosine, sine } of stages) {
      const span = length / 2
      for (let base = 0; base < size; base += length) {
        for (let n = 0; n < span; n++) {
          const a = base + n
          const b = a + span
          const r = real[b] * cosine[n] - imaginary[b] * sine[n]
          const i = real[b] * sine[n] + imaginary[b] * cosine[n]
          real[b] = real[a] - r
          imaginary[b] = imaginary[a] - i
          real[a] += r
          imaginary[a] += i
        }
      }
    }
    for (let n = 0; n < half; n++) magnitudes[n] = Math.hypot(real[n], imaginary[n]) / (size / 4)
    for (let y = 0; y < height; y++) {
      const bin = bins[y]
      const lower = Math.floor(bin)
      const magnitude = magnitudes[lower] * (1 - (bin - lower)) + magnitudes[Math.min(lower + 1, half - 1)] * (bin - lower)
      const db = 20 * Math.log10(Math.max(magnitude, 1e-8))
      const intensity = Math.max(0, Math.min(1, (db + 80) / 75))
      const first = intensity <= 0.65
      const blend = first ? intensity / 0.65 : (intensity - 0.65) / 0.35
      const from = first ? dark : middle
      const to = first ? middle : light
      const offset = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) image.data[offset + channel] = from[channel] + (to[channel] - from[channel]) * blend
      image.data[offset + 3] = 255
    }
  }
  spectrum.putImageData(image, 0, 0)
}

export function drawAudioAnalysis(buffer, waveform, beatWave, spectrogram, maxFrequencyHz) {
  const samples = buffer.getChannelData(0)
  if (!samples.length) throw new Error('Audio contains no samples')
  let squared = 0
  let peak = 0
  for (const sample of samples) {
    squared += sample * sample
    peak = Math.max(peak, Math.abs(sample))
  }
  const rms = Math.sqrt(squared / samples.length)
  const peakDb = 20 * Math.log10(Math.max(peak, 1e-9))
  const averageDb = 20 * Math.log10(Math.max(rms, 1e-9))

  const wave = waveform.getContext('2d')
  wave.clearRect(0, 0, waveform.width, waveform.height)
  wave.strokeStyle = accent()
  wave.beginPath()
  const beat = beatWave.getContext('2d')
  beat.clearRect(0, 0, beatWave.width, beatWave.height)
  beat.fillStyle = accent()
  for (let x = 0; x < waveform.width; x++) {
    const start = Math.floor(x * samples.length / waveform.width)
    const end = Math.floor((x + 1) * samples.length / waveform.width)
    let localPeak = 0
    let energy = 0
    for (let i = start; i < end; i++) {
      const value = samples[i]
      localPeak = Math.max(localPeak, Math.abs(value))
      energy += value * value
    }
    wave.moveTo(x, waveform.height / 2 - localPeak * waveform.height / 2)
    wave.lineTo(x, waveform.height / 2 + localPeak * waveform.height / 2)
    const xBeat = Math.floor(x * beatWave.width / waveform.width)
    const height = Math.min(beatWave.height, Math.sqrt(energy / Math.max(1, end - start)) * beatWave.height * 2)
    beat.fillRect(xBeat, beatWave.height - height, 1, height)
  }
  wave.stroke()

  drawSpectrogram(buffer, spectrogram, maxFrequencyHz)
  return { peakDb, averageDb, dynamicRange: peakDb - averageDb }
}
