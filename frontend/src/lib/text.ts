/** Text matching shared by search and the derived labels. */

/** Lowercase, accents stripped, hyphens as spaces: "Eén-pan Crème" -> "een pan creme". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[-_]+/g, ' ');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// No lookbehind in these patterns: older iOS Safari throws on it at parse time.
const WORD_START = '(?:^|[^\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';

/** Whether a word in `text` starts with `term` ("kip" finds "kipfilet", not "skip"). */
export function startsWord(text: string, term: string): boolean {
  return !!term && new RegExp(WORD_START + escapeRegex(term), 'u').test(text);
}

/**
 * Whether `term` occurs in already-normalised `text`.
 *
 * Plain substring matching was too loose for short words: "ui" (onion) matched
 * "fruit" and "quick", "ei" (egg) matched "protein", and "room" (cream) matched
 * every "mushroom". So:
 *   - up to 2 letters: whole word only
 *   - 3-4 letters: start of a word
 *   - 5 or more: anywhere, so Dutch compounds still hit ("gehakt" in
 *     "rundergehakt")
 */
export function containsTerm(text: string, term: string): boolean {
  if (!term) return false;
  if (term.length >= 5) return text.includes(term);
  if (term.length <= 2) return new RegExp(WORD_START + escapeRegex(term) + WORD_END, 'u').test(text);
  return startsWord(text, term);
}
