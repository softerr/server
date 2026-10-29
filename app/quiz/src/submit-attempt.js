export async function submitAttempt({ saveAnswers, saveTime, complete }) {
  if (saveAnswers) await saveAnswers()
  try {
    void Promise.resolve(saveTime()).catch(() => {})
  } catch {
    // Time spent is informational; a failed timing update must not block completion.
  }
  return complete()
}
