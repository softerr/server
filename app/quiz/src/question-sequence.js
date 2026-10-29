export function createPreviewQuestionSequence(questions, quiz, random = Math.random) {
  if (!questions.length) throw new Error('A quiz preview needs at least one question')
  const pool = [...questions]
  if (quiz.question_limit === null && quiz.randomize_questions) {
    for (let index = pool.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1))
      ;[pool[index], pool[other]] = [pool[other], pool[index]]
    }
  }
  const selectedIndexes = []
  return {
    initialCount: quiz.question_limit === 0 ? 1 : quiz.question_limit === null ? pool.length : quiz.question_limit,
    next() {
      let choice = selectedIndexes.length % pool.length
      if (quiz.randomize_questions && quiz.question_limit !== null) {
        const previous = selectedIndexes.at(-1)
        if (previous === undefined || pool.length === 1) {
          choice = Math.floor(random() * pool.length)
        } else {
          choice = Math.floor(random() * (pool.length - 1))
          if (choice >= previous) choice++
        }
      }
      selectedIndexes.push(choice)
      return pool[choice]
    },
  }
}
