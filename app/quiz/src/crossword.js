import { normalizeCrosswordAnswer, numberedCrosswordEntries } from './crossword-layout.js'

function element(tag, className = '', text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function modelFor(entries) {
  const numbered = numberedCrosswordEntries(entries)
  const cells = new Map()
  let rows = 0
  let cols = 0
  numbered.forEach((entry, index) => {
    const length = entry.length ?? entry.answer?.length ?? 0
    entry.positions = []
    for (let offset = 0; offset < length; offset++) {
      const row = entry.row + (entry.direction === 'down' ? offset : 0)
      const col = entry.col + (entry.direction === 'across' ? offset : 0)
      const key = `${row},${col}`
      if (!cells.has(key)) cells.set(key, { row, col, entries: [], letter: entry.answer?.[offset] ?? '' })
      cells.get(key).entries.push(index)
      if (offset === 0) cells.get(key).number = entry.number
      entry.positions.push(key)
      rows = Math.max(rows, row + 1)
      cols = Math.max(cols, col + 1)
    }
  })
  return { entries: numbered, cells, rows, cols }
}

function gridFor(model, playable) {
  const grid = element('div', 'crossword-grid')
  grid.style.setProperty('--crossword-cols', model.cols)
  grid.setAttribute('role', 'group')
  grid.setAttribute('aria-label', 'Crossword grid')
  const inputs = new Map()
  for (let row = 0; row < model.rows; row++) {
    for (let col = 0; col < model.cols; col++) {
      const cell = model.cells.get(`${row},${col}`)
      if (!cell) {
        const block = element('span', 'crossword-block')
        block.setAttribute('aria-hidden', 'true')
        grid.append(block)
        continue
      }
      const square = element('div', 'crossword-cell')
      if (cell.number) square.append(element('span', 'crossword-cell-number', String(cell.number)))
      if (playable) {
        const input = document.createElement('input')
        input.type = 'text'
        input.inputMode = 'text'
        input.autocomplete = 'off'
        input.maxLength = 1
        input.setAttribute('aria-label', `Row ${row + 1}, column ${col + 1}`)
        square.append(input)
        inputs.set(`${row},${col}`, input)
      } else square.append(element('span', 'crossword-preview-letter', cell.letter))
      cell.square = square
      grid.append(square)
    }
  }
  return { grid, inputs }
}

function clueLists(model, interactive, onSelect) {
  const wrapper = element('div', 'crossword-clues')
  const buttons = new Map()
  for (const direction of ['across', 'down']) {
    const section = element('section', 'crossword-clue-section')
    section.append(element('h3', '', direction === 'across' ? 'Across' : 'Down'))
    const list = element('ol', '')
    model.entries.map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.direction === direction)
      .sort((a, b) => a.entry.number - b.entry.number)
      .forEach(({ entry, index }) => {
        const item = element('li')
        const label = `${entry.number}. ${entry.clue} (${entry.positions.length})`
        if (interactive) {
          const button = element('button', 'crossword-clue-button', label)
          button.type = 'button'
          button.addEventListener('click', () => onSelect(index))
          buttons.set(index, button)
          item.append(button)
        } else item.textContent = label
        list.append(item)
      })
    section.append(list)
    wrapper.append(section)
  }
  return { wrapper, buttons }
}

export function renderCrosswordPreview(container, entries) {
  const model = modelFor(entries)
  const { grid } = gridFor(model, false)
  const { wrapper } = clueLists(model, false)
  const scroller = element('div', 'crossword-grid-scroll')
  scroller.append(grid)
  container.replaceChildren(scroller, wrapper)
}

export function createCrosswordActivity(answer, config) {
  const model = modelFor(config.entries ?? [])
  const area = element('div', 'play-crossword-activity')
  area.append(element('p', 'play-instruction', 'Select a clue, then fill the crossing letters.'))
  const { grid, inputs } = gridFor(model, true)
  const scroller = element('div', 'crossword-grid-scroll')
  scroller.append(grid)
  let active = 0
  const { wrapper: clues, buttons } = clueLists(model, true, (index) => select(index, true))
  area.append(scroller, clues)
  answer.append(area)

  function select(index, focus = false) {
    active = index
    for (const [at, entry] of model.entries.entries()) {
      buttons.get(at)?.classList.toggle('is-active', at === active)
      for (const key of entry.positions) {
        if (at === active) model.cells.get(key).square.classList.add('is-active')
        else if (!model.cells.get(key).entries.includes(active)) model.cells.get(key).square.classList.remove('is-active')
      }
    }
    if (focus) inputs.get(model.entries[index].positions[0])?.focus()
  }
  select(0)

  function writeLetters(key, letters) {
    const cell = model.cells.get(key)
    if (!cell.entries.includes(active)) select(cell.entries[0])
    const positions = model.entries[active].positions
    const start = positions.indexOf(key)
    for (let offset = 0; offset < letters.length && start + offset < positions.length; offset++) {
      inputs.get(positions[start + offset]).value = letters[offset]
    }
    const next = positions[Math.min(start + letters.length, positions.length - 1)]
    inputs.get(next)?.focus()
    area.dispatchEvent(new Event('change', { bubbles: true }))
  }

  for (const [key, input] of inputs) {
    const cell = model.cells.get(key)
    input.addEventListener('focus', () => {
      if (!cell.entries.includes(active)) select(cell.entries[0])
    })
    input.addEventListener('input', () => {
      const letters = normalizeCrosswordAnswer(input.value)
      if (letters) writeLetters(key, letters)
      else { input.value = ''; area.dispatchEvent(new Event('change', { bubbles: true })) }
    })
    input.addEventListener('paste', (event) => {
      const letters = normalizeCrosswordAnswer(event.clipboardData?.getData('text') ?? '')
      if (!letters) return
      event.preventDefault()
      writeLetters(key, letters)
    })
    input.addEventListener('click', () => {
      if (!cell.entries.includes(active)) select(cell.entries[0])
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value) {
        const positions = model.entries[active].positions
        const previous = positions[positions.indexOf(key) - 1]
        if (previous) { event.preventDefault(); inputs.get(previous).focus(); inputs.get(previous).value = ''
          area.dispatchEvent(new Event('change', { bubbles: true })) }
      }
      const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key]
      if (delta) {
        const target = inputs.get(`${cell.row + delta[0]},${cell.col + delta[1]}`)
        if (target) { event.preventDefault(); target.focus() }
      }
    })
  }

  return {
    grade: () => model.entries.every((entry) => typeof entry.answer === 'string')
      ? model.entries.every((entry) => entry.positions.every((key, index) =>
        inputs.get(key).value === entry.answer[index])) : null,
    getAnswer: () => ({ cells: Object.fromEntries([...inputs].filter(([, input]) => input.value)
      .map(([key, input]) => [key, input.value])) }),
    restoreAnswer(saved) {
      if (!saved?.cells || typeof saved.cells !== 'object') return
      for (const [key, input] of inputs) {
        const value = saved.cells[key]
        input.value = typeof value === 'string' && /^[A-Za-z]$/.test(value) ? value.toUpperCase() : ''
      }
    },
  }
}
