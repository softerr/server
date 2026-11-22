export function normalizeCrosswordAnswer(value) {
  const raw = String(value ?? '').trim()
  if (!/^[\p{Script=Latin}\p{Mark}\s'-]+$/u.test(raw)) return ''
  const letters = raw.normalize('NFKD').replace(/\p{Mark}/gu, '').toUpperCase().replace(/[^A-Z]/g, '')
  const sourceLetters = [...raw.matchAll(/\p{Letter}/gu)].length
  return letters.length >= sourceLetters ? letters : ''
}

export function numberedCrosswordEntries(entries) {
  const starts = [...new Set(entries.map((entry) => `${entry.row},${entry.col}`))]
    .map((key) => key.split(',').map(Number))
    .sort(([aRow, aCol], [bRow, bCol]) => aRow - bRow || aCol - bCol)
  const numbers = new Map(starts.map(([row, col], index) => [`${row},${col}`, index + 1]))
  return entries.map((entry) => ({ ...entry, number: numbers.get(`${entry.row},${entry.col}`) }))
}

export function layoutCrossword(drafts) {
  if (!Array.isArray(drafts) || drafts.length < 2 || drafts.length > 20) {
    throw new Error('Add 2 to 20 crossword entries.')
  }
  const words = drafts.map((entry, index) => {
    const answer = normalizeCrosswordAnswer(entry.answer)
    if (answer.length < 2 || answer.length > 20) {
      throw new Error(`Entry ${index + 1} needs 2 to 20 Latin letters.`)
    }
    return { index, answer, clue: String(entry.clue ?? '').trim() }
  })
  if (new Set(words.map((word) => word.answer)).size !== words.length) {
    throw new Error('Crossword answers must be distinct.')
  }

  const cells = new Map()
  let minRow = Infinity
  let maxRow = -Infinity
  let minCol = Infinity
  let maxCol = -Infinity
  const placements = Array(words.length)
  const pending = [...words].sort((a, b) => b.answer.length - a.answer.length || a.index - b.index)
  const key = (row, col) => `${row},${col}`
  const step = (direction) => direction === 'across' ? [0, 1] : [1, 0]
  function boundsWith(word, row, col, direction) {
    const [dr, dc] = step(direction)
    const endRow = row + dr * (word.length - 1)
    const endCol = col + dc * (word.length - 1)
    return (Math.max(maxRow, endRow) - Math.min(minRow, row) + 1)
      * (Math.max(maxCol, endCol) - Math.min(minCol, col) + 1)
  }
  function fits(word, row, col, direction) {
    const [dr, dc] = step(direction)
    if (cells.has(key(row - dr, col - dc)) || cells.has(key(row + dr * word.length, col + dc * word.length))) return 0
    let crossings = 0
    for (let offset = 0; offset < word.length; offset++) {
      const r = row + dr * offset
      const c = col + dc * offset
      const existing = cells.get(key(r, c))
      if (existing) {
        if (existing.letter !== word[offset] || existing.directions.has(direction)) return 0
        crossings++
      } else if (direction === 'across'
        ? cells.has(key(r - 1, c)) || cells.has(key(r + 1, c))
        : cells.has(key(r, c - 1)) || cells.has(key(r, c + 1))) return 0
    }
    const area = boundsWith(word, row, col, direction)
    return area <= 3600 ? crossings : 0
  }
  function place(word, row, col, direction) {
    const [dr, dc] = step(direction)
    for (let offset = 0; offset < word.answer.length; offset++) {
      const position = key(row + dr * offset, col + dc * offset)
      const existing = cells.get(position)
      if (existing) existing.directions.add(direction)
      else cells.set(position, { letter: word.answer[offset], directions: new Set([direction]) })
      minRow = Math.min(minRow, row + dr * offset)
      maxRow = Math.max(maxRow, row + dr * offset)
      minCol = Math.min(minCol, col + dc * offset)
      maxCol = Math.max(maxCol, col + dc * offset)
    }
    placements[word.index] = { answer: word.answer, clue: word.clue, row, col, direction }
  }

  place(pending.shift(), 0, 0, 'across')
  while (pending.length) {
    let best = null
    for (const word of pending) {
      for (const [position, existing] of cells) {
        const [crossRow, crossCol] = position.split(',').map(Number)
        for (let offset = 0; offset < word.answer.length; offset++) {
          if (word.answer[offset] !== existing.letter) continue
          for (const direction of ['across', 'down']) {
            if (existing.directions.has(direction)) continue
            const [dr, dc] = step(direction)
            const row = crossRow - dr * offset
            const col = crossCol - dc * offset
            const crossings = fits(word.answer, row, col, direction)
            if (!crossings) continue
            const area = boundsWith(word.answer, row, col, direction)
            const score = crossings * 10000 - area
            if (!best || score > best.score) best = { word, row, col, direction, score }
          }
        }
      }
    }
    if (best) {
      place(best.word, best.row, best.col, best.direction)
      pending.splice(pending.indexOf(best.word), 1)
      continue
    }
    const word = pending.shift()
    place(word, maxRow + 2, 0, 'across')
  }

  const normalized = placements.map((entry) => ({
    ...entry, row: entry.row - minRow, col: entry.col - minCol,
  }))
  const height = maxRow - minRow + 1
  const width = maxCol - minCol + 1
  if (height > 60 || width > 60) throw new Error('This crossword is too large. Try shorter answers.')
  return normalized
}
