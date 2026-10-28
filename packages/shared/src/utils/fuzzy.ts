/** Text normalization + fuzzy similarity used by search merging and lyric matching. */

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (combining marks)
    .replace(/['’"“”.,:;!?()\[\]{}|/\\_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(input: string): Set<string> {
  return new Set(normalize(input).split(" ").filter(Boolean));
}

/**
 * Token-set similarity in [0,1]: twice the size of the intersection divided by
 * the sum of set sizes (a.k.a. Dice coefficient). Order-insensitive, so
 * "lights blinding" === "blinding lights".
 */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/** Exact-ish match boost: normalized equality or containment. */
export function exactBoost(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.6;
  return 0;
}

/**
 * Combined score in [0,1] for matching free text against "Title - Artist"
 * style strings (used by lyric match ranking).
 */
export function matchScore(query: string, candidate: string): number {
  const s = similarity(query, candidate);
  const e = exactBoost(query, candidate);
  return Math.min(1, 0.7 * s + 0.3 * e + (e === 1 ? 0.3 : 0));
}
