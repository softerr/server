function accent() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d08b38'
}

export function drawAudioAnalysis(buffer, waveform, beatWave, spectrogram) {
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

  const spectrum = spectrogram.getContext('2d')
  const image = spectrum.createImageData(spectrogram.width, spectrogram.height)
  const windowSize = 256
  const window = Float32Array.from({ length: windowSize }, (_, n) =>
    0.5 - 0.5 * Math.cos(2 * Math.PI * n / windowSize))
  const cos = Array.from({ length: 128 }, (_, frequency) =>
    Float32Array.from({ length: windowSize }, (_, n) => Math.cos(2 * Math.PI * frequency * n / windowSize)))
  const sin = Array.from({ length: 128 }, (_, frequency) =>
    Float32Array.from({ length: windowSize }, (_, n) => Math.sin(2 * Math.PI * frequency * n / windowSize)))
  for (let x = 0; x < spectrogram.width; x++) {
    const start = Math.max(0, Math.min(samples.length - windowSize,
      Math.floor(x * samples.length / spectrogram.width)))
    for (let frequency = 0; frequency < spectrogram.height; frequency++) {
      let real = 0
      let imaginary = 0
      const bin = frequency * 128 / spectrogram.height | 0
      for (let n = 0; n < windowSize; n++) {
        const value = (samples[start + n] ?? 0) * window[n]
        real += value * cos[bin][n]
        imaginary -= value * sin[bin][n]
      }
      const intensity = Math.min(1, Math.log1p(Math.hypot(real, imaginary)) / 4)
      const offset = ((spectrogram.height - 1 - frequency) * spectrogram.width + x) * 4
      image.data[offset] = Math.round(208 * intensity)
      image.data[offset + 1] = Math.round(139 * intensity)
      image.data[offset + 2] = Math.round(56 * intensity)
      image.data[offset + 3] = 255
    }
  }
  spectrum.putImageData(image, 0, 0)
  return { peakDb, averageDb, dynamicRange: peakDb - averageDb }
}
