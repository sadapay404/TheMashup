/**
 * Text normalization for lyric matching.
 * Total function: any non-string input degrades to '' (proven by the hostile-input test).
 */

const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can do does did for from had has have he her here hers him his how i if in ' +
    'into is it its just like me my no not now of on or our out she so some that the their them then there these ' +
    'they this those to too up us was we were what when where which who why will with you your yours im ive dont ' +
    'cant wont thats gonna gotta wanna yeah oh ah la na'
  ).split(' '),
);

export function normalize(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc']/g, '')
    .replace(/[^a-z0-9\u0900-\u097F\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keeps Devanagari and Arabic script ranges so non-Latin lyrics still match. */
export function tokenize(s: unknown): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Does the input look like a lyric phrase rather than a title/artist query? */
export function looksLikeLyrics(input: string): boolean {
  const contentWords = tokenize(input);
  // A long phrase is a lyric phrase regardless of word choice.
  if (contentWords.length >= 8) return true;

  const raw = String(input ?? '').trim();
  const totalWords = raw.split(/\s+/).filter(Boolean).length;
  // Titles/artists are short; lyrics are phrases.
  if (totalWords < 4) return false;

  const lyricCues = /\b(and|but|when|if|just|like|so|that|this|all|no|from|of|in|to|my|your|i|you|we)\b/gi;
  const cueCount = (raw.match(lyricCues) ?? []).length;
  // ≥2 function words in a ≥4-word phrase is a strong lyric signal ("caught in a landslide no escape").
  return cueCount >= 2;
}

/** "Artist - Title" / "Title by Artist" detection for the structured-search path. */
export function looksLikeStructured(input: string): { artist: string; title: string } | null {
  const dash = input.split(/\s+[-–—]\s+/);
  if (dash.length === 2 && dash[0] && dash[1]) return { artist: dash[0].trim(), title: dash[1].trim() };
  const by = input.split(/\s+by\s+/i);
  if (by.length === 2 && by[0] && by[1]) return { title: by[0].trim(), artist: by[1].trim() };
  return null;
}
