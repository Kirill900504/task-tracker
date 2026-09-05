// Guard for the "let the model reword this" step used by the daily brief and
// the weekly review.
//
// The draft those build from facts is always correct; the model is only there
// to make it read better. In testing it did two things that make an answer
// worse than the draft it started from: invented numbers ("ещё 6 задач" when
// there were three) and dropped the task titles entirely, leaving "задача
// Никиты Козлова" where the draft named the task. Either one means the
// rewrite is not usable, and the draft goes out instead.

function numbersIn(text: string): Set<number> {
  return new Set((text.match(/\d+/g) || []).map(Number));
}

export function rewriteIsFaithful(draft: string, candidate: string, mustMention: string[]): boolean {
  if (!candidate) return false;

  const allowed = numbersIn(draft);
  for (const n of numbersIn(candidate)) {
    if (!allowed.has(n)) return false;
  }

  const haystack = candidate.toLowerCase();
  for (const phrase of mustMention) {
    const needle = phrase.trim().toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
  }
  return true;
}
