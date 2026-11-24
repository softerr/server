function element(tag, text) {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}

export function renderScoreSummary(summary, { title, score, notice = '', actions = [] }) {
  const { graded = 0, correct = 0, ungraded = 0,
    match_total: matchTotal = 0, match_correct: matchCorrect = 0,
    diagram_total: diagramTotal = 0, diagram_correct: diagramCorrect = 0 } = score || {}
  summary.replaceChildren(
    element('h2', title),
    element('p', graded
      ? `${correct} of ${graded} automatically graded questions correct.`
      : 'This quiz has no automatically graded questions.'),
  )
  if (matchTotal) summary.append(element('p', `Match choices: ${matchCorrect} of ${matchTotal} correct.`))
  if (diagramTotal) summary.append(element('p', `Diagram labels: ${diagramCorrect} of ${diagramTotal} correct.`))
  if (ungraded) summary.append(element('p', `${ungraded} questions were not automatically graded.`))
  if (notice) summary.append(element('p', notice))
  summary.append(...actions)
  summary.hidden = false
}
