const choices = new Set(['multiple_choice', 'one_choice'])
const imageLists = new Set(['multiple_choice', 'one_choice', 'match', 'ordering', 'fill_blanks', 'categorize'])
const lists = new Set([...imageLists, 'wheel', 'labeled_diagram', 'crossword'])

function entries(template, config) {
  if (choices.has(template)) return (config.options ?? []).map((option) => ({ ...option }))
  if (template === 'wheel') return (config.options ?? []).map((text) => ({ text }))
  if (template === 'match') return (config.pairs ?? []).map((pair) => ({
    text: pair.keyword, image_id: pair.keyword_image_id,
    definition: pair.definition, definition_image_id: pair.definition_image_id,
  }))
  if (template === 'ordering') return (config.items ?? []).map((item) => ({ ...item }))
  if (template === 'fill_blanks') return (config.answers ?? []).map((item) => ({ ...item }))
  if (template === 'categorize') return (config.categories ?? []).flatMap((category) =>
    (category.items ?? []).map((item) => ({ ...item })))
  if (template === 'labeled_diagram') return (config.labels ?? []).map((label) => ({ ...label }))
  if (template === 'crossword') return (config.entries ?? []).map((entry) => ({
    text: entry.answer, clue: entry.clue,
  }))
  if (template === 'true_false' || template === 'yes_no') {
    const labels = template === 'true_false' ? ['True', 'False'] : ['Yes', 'No']
    return labels.map((text, index) => ({ text, correct: config.answer === (index === 0) }))
  }
  const answer = template === 'open' ? config.sample_answer : config.answer
  return typeof answer === 'string' && answer ? [{ text: answer }] : []
}

function imageId(source, previous, supportsImages) {
  return supportsImages ? source.image_id : previous?.image_id
}

function textImage(source, previous, supportsImages) {
  const id = imageId(source, previous, supportsImages)
  return { text: source.text ?? '', ...(id ? { image_id: id } : {}) }
}

function atLeast(rows, minimum, empty) {
  while (rows.length < minimum) rows.push(empty())
  return rows
}

function correspondingRows(source, previous = [], textOf = (row) => row.text) {
  const used = new Set()
  return source.map((item, index) => {
    let match = item.text ? previous.findIndex((row, at) =>
      !used.has(at) && textOf(row) === item.text) : -1
    if (match < 0 && index < previous.length && !used.has(index)) match = index
    if (match < 0) match = previous.findIndex((_, at) => !used.has(at))
    if (match >= 0) used.add(match)
    return previous[match]
  })
}

export function convertTemplateConfig(from, to, current, cached = null) {
  if (from === to) return current
  if (cached && !lists.has(from) && lists.has(to)) return cached
  let source = entries(from, current)
  if (from === 'labeled_diagram' && lists.has(to) && cached) {
    source = [...source, ...entries(to, cached).slice(30)]
  }
  if (!source.length && cached) return cached
  const supportsImages = imageLists.has(from)
  const old = cached ?? {}

  if (choices.has(to)) {
    const previous = correspondingRows(source, old.options)
    const options = atLeast(source.map((item, index) => ({
      ...textImage(item, previous[index], supportsImages),
      correct: from === 'one_choice' && to === 'multiple_choice' && cached
        ? Boolean(item.correct || previous[index]?.correct)
        : choices.has(from) || from === 'true_false' || from === 'yes_no'
          ? Boolean(item.correct) : Boolean(previous[index]?.correct),
    })), 2, () => ({ text: '', correct: false }))
    if (to === 'one_choice') {
      let found = false
      for (const option of options) {
        if (option.correct && found) option.correct = false
        else if (option.correct) found = true
      }
    }
    return { options }
  }

  if (to === 'wheel') {
    return { options: atLeast(source.map((item) => item.text ?? ''), 2, () => '') }
  }

  if (to === 'ordering' || to === 'fill_blanks') {
    const key = to === 'ordering' ? 'items' : 'answers'
    const previous = correspondingRows(source, old[key])
    return { [key]: atLeast(source.map((item, index) =>
      textImage(item, previous[index], supportsImages)), to === 'ordering' ? 2 : 1,
    () => ({ text: '' })) }
  }

  if (to === 'match') {
    const previousRows = correspondingRows(source, old.pairs, (pair) => pair.keyword)
    return { pairs: atLeast(source.map((item, index) => {
      const previous = previousRows[index]
      const keywordId = imageId(item, { image_id: previous?.keyword_image_id }, supportsImages)
      const definitionId = from === 'match' ? item.definition_image_id : previous?.definition_image_id
      return {
        keyword: item.text ?? '', definition: item.definition ?? item.clue ?? previous?.definition ?? '',
        ...(keywordId ? { keyword_image_id: keywordId } : {}),
        ...(definitionId ? { definition_image_id: definitionId } : {}),
      }
    }), 2, () => ({ keyword: '', definition: '' })) }
  }

  if (to === 'labeled_diagram') {
    const previous = correspondingRows(source.slice(0, 30), old.labels)
    const labels = atLeast(source.slice(0, 30).map((item, index) => ({
      text: item.text ?? '',
      x: item.x ?? previous[index]?.x ?? null,
      y: item.y ?? previous[index]?.y ?? null,
    })), 2, () => ({ text: '', x: null, y: null }))
    const diagramId = cached ? old.diagram_image_id : current.diagram_image_id ?? current.image_id
    return { labels, ...(diagramId ? { diagram_image_id: diagramId } : {}) }
  }

  if (to === 'crossword') {
    const previous = correspondingRows(source, old.entries, (entry) => entry.answer)
    return { entries: atLeast(source.map((item, index) => ({
      answer: item.text ?? '', clue: item.clue ?? item.definition ?? previous[index]?.clue ?? '',
    })), 2, () => ({ answer: '', clue: '' })) }
  }

  if (to === 'categorize') {
    const categories = cached?.categories?.length >= 2 ? cached.categories
      : [
        { name: '', items: Array.from({ length: Math.max(1, Math.ceil(source.length / 2)) }, () => ({})) },
        { name: '', items: [{}] },
      ]
    const previous = correspondingRows(source, categories.flatMap((category) => category.items ?? []))
    let position = 0
    return { categories: categories.map((category, index) => {
      const last = index === categories.length - 1
      const available = Math.max(0, source.length - position - (categories.length - index - 1))
      const count = last ? Math.max(1, source.length - position)
        : Math.max(1, Math.min(category.items?.length ?? 1, available))
      const items = atLeast(source.slice(position, position + count).map((item, itemIndex) =>
        textImage(item, previous[position + itemIndex], supportsImages)), 1, () => ({ text: '' }))
      position += count
      return { ...category, items }
    }) }
  }

  if (to === 'true_false' || to === 'yes_no') {
    if (typeof current.answer === 'boolean') return { answer: current.answer }
    const selected = source.find((item) => item.correct)?.text?.trim().toLowerCase()
    const truthy = to === 'true_false' ? 'true' : 'yes'
    const falsy = to === 'true_false' ? 'false' : 'no'
    return { answer: selected === truthy ? true : selected === falsy ? false : old.answer ?? null }
  }

  if (to === 'no_answer') return {}
  const selected = source.find((item) => item.correct && item.text)?.text
    ?? source.find((item) => item.text)?.text
  const answer = selected ?? (to === 'open' ? old.sample_answer : old.answer) ?? ''
  return to === 'open' ? { sample_answer: answer } : { answer }
}
