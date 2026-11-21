const colors = ['#e53935', '#1976d2', '#f57c00', '#009e6d', '#8e44ad', '#d81b60', '#008fa3', '#bd8200']

export function nextWheelRotation(rotation, position, count) {
  const center = (position + 0.5) * 360 / count
  const current = ((rotation % 360) + 360) % 360
  const target = ((-center % 360) + 360) % 360
  return rotation + 360 * 5 + ((target - current + 360) % 360)
}

function element(tag, className = '', text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function createWheelActivity(answer, options) {
  const area = element('div', 'play-wheel-activity')
  const instruction = element('p', 'play-instruction',
    'Spin the wheel. Keep the result and continue, spin again, or eliminate it and spin again.')
  const stage = element('div', 'play-wheel-stage')
  const pointer = element('span', 'play-wheel-pointer')
  pointer.setAttribute('aria-hidden', 'true')
  const disc = element('div', 'play-wheel-disc')
  stage.append(pointer, disc)
  const result = element('p', 'play-wheel-result', 'Spin to choose an option.')
  result.setAttribute('role', 'status')
  result.setAttribute('aria-live', 'polite')
  const actions = element('div', 'play-wheel-actions')
  const spinButton = element('button', 'auth-button auth-button-primary', 'Spin wheel')
  spinButton.type = 'button'
  const eliminateButton = element('button', 'auth-button auth-button-secondary', 'Eliminate and spin again')
  eliminateButton.type = 'button'
  actions.append(spinButton, eliminateButton)
  area.append(instruction, stage, result, actions)
  answer.append(area)

  let remaining = options.map((_, index) => index)
  let selected = null
  let spins = 0
  let rotation = 0
  let spinning = false
  let locked = false
  let timer = null

  function draw() {
    const count = remaining.length
    disc.style.background = `conic-gradient(${remaining.map((_, index) =>
      `${colors[index % colors.length]} ${index / count * 100}% ${(index + 1) / count * 100}%`).join(', ')})`
    disc.replaceChildren()
    remaining.forEach((optionIndex, index) => {
      const angle = (index + 0.5) * Math.PI * 2 / count - Math.PI / 2
      const spoke = element('span', 'play-wheel-spoke')
      spoke.style.left = `${50 + Math.cos(angle) * 46.5}%`
      spoke.style.top = `${50 + Math.sin(angle) * 46.5}%`
      spoke.style.transform = `rotate(${angle * 180 / Math.PI + 180}deg)`
      spoke.style.width = count <= 8 ? '40%' : count <= 20 ? '36%' : '28%'
      const label = element('span', 'play-wheel-sector', options[optionIndex])
      label.classList.toggle('is-dark', [2, 3, 6, 7].includes(index % colors.length))
      label.style.fontSize = `${Math.max(8, Math.min(16, Math.round(100 / count + 6)))}px`
      label.title = options[optionIndex]
      spoke.append(label)
      disc.append(spoke)
    })
    result.textContent = spinning ? 'Spinning…'
      : selected === null ? 'Spin to choose an option.' : `Result: ${options[selected]}`
    spinButton.textContent = selected === null ? 'Spin wheel' : 'Spin again'
    spinButton.disabled = locked || spinning
    eliminateButton.hidden = selected === null || remaining.length <= 1
    eliminateButton.disabled = locked || spinning
  }

  function spin() {
    if (locked || spinning || !remaining.length) return
    spinning = true
    selected = null
    const chosen = remaining[Math.floor(Math.random() * remaining.length)]
    rotation = nextWheelRotation(rotation, remaining.indexOf(chosen), remaining.length)
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0 : 3200
    draw()
    area.dispatchEvent(new Event('change', { bubbles: true }))
    disc.style.transition = 'none'
    void disc.offsetWidth
    disc.style.transition = `transform ${duration}ms cubic-bezier(.12,.8,.18,1)`
    disc.style.transform = `rotate(${rotation}deg)`
    timer = setTimeout(() => {
      if (locked || !area.isConnected) return
      spinning = false
      selected = chosen
      spins++
      draw()
      area.dispatchEvent(new Event('change', { bubbles: true }))
    }, duration)
  }

  spinButton.addEventListener('click', spin)
  eliminateButton.addEventListener('click', () => {
    if (locked || spinning || selected === null || remaining.length <= 1) return
    remaining = remaining.filter((index) => index !== selected)
    selected = null
    draw()
    area.dispatchEvent(new Event('change', { bubbles: true }))
    spin()
  })
  draw()

  return {
    grade: () => null,
    canContinue: () => selected !== null && !spinning,
    getAnswer: () => ({ selected, remaining: [...remaining], spins }),
    restoreAnswer(saved) {
      if (!Array.isArray(saved?.remaining) || !saved.remaining.length
        || new Set(saved.remaining).size !== saved.remaining.length
        || !saved.remaining.every((index) => Number.isInteger(index) && index >= 0 && index < options.length)) return
      remaining = options.map((_, index) => index).filter((index) => saved.remaining.includes(index))
      selected = Number.isInteger(saved.selected) && remaining.includes(saved.selected) ? saved.selected : null
      spins = Number.isInteger(saved.spins) && saved.spins >= 0 ? saved.spins : 0
      rotation = selected === null ? 0 : -(remaining.indexOf(selected) + 0.5) * 360 / remaining.length
      disc.style.transition = 'none'
      disc.style.transform = `rotate(${rotation}deg)`
      draw()
    },
    finish() {
      locked = true
      clearTimeout(timer)
      spinning = false
      draw()
    },
  }
}
