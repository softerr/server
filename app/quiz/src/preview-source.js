import { createPreviewQuestionSequence } from './question-sequence.js'

export function createPreviewSource(quiz, questions) {
  const sequence = createPreviewQuestionSequence(questions, quiz)

  function shuffle(items) {
    const copy = [...items]
    for (let index = copy.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1))
      ;[copy[index], copy[other]] = [copy[other], copy[index]]
    }
    return copy
  }

  function present(source) {
    if (!quiz.randomize_answers) return source
    const config = { ...source.config }
    if (['multiple_choice', 'one_choice'].includes(source.template)) config.options = shuffle(config.options)
    if (source.template === 'match') config.pairs = shuffle(config.pairs)
    if (source.template === 'categorize') config.categories = shuffle(config.categories)
    return { ...source, config }
  }

  return { initialCount: sequence.initialCount, nextQuestion: () => present(sequence.next()) }
}
