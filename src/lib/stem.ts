// Crude Russian stemmer: strips the common endings so a word matches its own
// inflections ("Севастополь" ↔ "Севастополю", "склад" ↔ "склада"). Shared by
// the tracker search and the meeting matcher.
//
// Deliberately rough — a stem that comes out slightly too short only widens
// the net, and in both callers a human sees the result before anything
// happens, so a false positive costs nothing while a miss is annoying.
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 4) return w;
  return w.replace(/(ами|ями|ого|ему|ому|ыми|ими|ая|ое|ые|ий|ый|ой|ем|ом|ах|ях|ов|ев|ей|ю|я|ы|и|а|е|у|о)$/u, "");
}

// Two words counted as the same when they open with the same `min`
// letters. Russian inflections are what the stemmer above cannot always
// line up («Никите» vs «Никита», «посмотрит» vs «посмотреть»), and a
// shared opening is a good enough stand-in for a real morphology library.
export function sharesPrefix(a: string, b: string, min: number): boolean {
  if (a === b) return true;
  const limit = Math.min(a.length, b.length);
  let common = 0;
  while (common < limit && a[common] === b[common]) common++;
  return common >= min;
}
