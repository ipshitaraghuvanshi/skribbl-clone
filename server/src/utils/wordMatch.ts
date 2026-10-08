/**
 * Word-matching rules:
 *  - case-insensitive
 *  - leading/trailing whitespace trimmed, inner whitespace collapsed
 *  - hyphens/underscores treated as spaces, other punctuation ignored
 *  - "close" = Levenshtein distance 1 (or 2 for words longer than 6 chars);
 *    close guesses are told privately to the guesser and are NOT correct.
 *  - partial matches (substring) are never accepted as correct.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[-_]/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

export type GuessVerdict = 'correct' | 'close' | 'wrong';

export function checkGuess(guess: string, word: string): GuessVerdict {
  const g = normalize(guess);
  const w = normalize(word);
  if (!g) return 'wrong';
  if (g === w) return 'correct';
  // compare without spaces too ("ice cream" == "icecream")
  if (g.replace(/ /g, '') === w.replace(/ /g, '')) return 'correct';
  const threshold = w.length > 6 ? 2 : 1;
  if (w.length >= 3 && levenshtein(g, w) <= threshold) return 'close';
  return 'wrong';
}
