/**
 * On-device fuzzy lyric recognition (BM25 + typo tolerance + rank fusion).
 * Proven in spike/lyric-matcher.mjs; this is the production version with the same behaviour.
 *
 * Amendment A-2: LRCLIB has no lyric-body search, so this index is not an optimisation — it is the
 * only way the headline feature can exist. It runs entirely on the user's device.
 */

import { tokenize } from './normalize.js';

export interface LyricDoc {
  /** Track id (videoId). */
  id: string;
  title: string;
  artist: string;
  lyrics: string;
}

export interface LyricHit {
  doc: LyricDoc;
  score: number;
  /** Matched snippet around the best-matching region, for the result card. */
  snippet: string;
  coverage: number;
}

interface BuiltIndex {
  docs: LyricDoc[];
  postings: Map<string, Map<number, number>>;
  docLen: number[];
  avgLen: number;
  tokensPerDoc: Set<string>[];
  vocab: string[];
}

const K1 = 1.4;
const B = 0.72;

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0] as number;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if ((cur[j] as number) < best) best = cur[j] as number;
    }
    if (best > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] as number;
}

export class LyricIndex {
  private built: BuiltIndex | null = null;

  constructor(private docs: LyricDoc[] = []) {
    this.build();
  }

  get size(): number {
    return this.docs.length;
  }

  setDocs(docs: LyricDoc[]): void {
    this.docs = docs;
    this.build();
  }

  addDoc(doc: LyricDoc): void {
    if (this.docs.some((d) => d.id === doc.id)) return;
    this.docs.push(doc);
    this.build();
  }

  has(id: string): boolean {
    return this.docs.some((d) => d.id === id);
  }

  private build(): void {
    const postings = new Map<string, Map<number, number>>();
    const docLen: number[] = [];
    const tokensPerDoc: Set<string>[] = [];

    this.docs.forEach((doc, idx) => {
      const toks = tokenize(`${doc.title} ${doc.artist} ${doc.lyrics}`);
      tokensPerDoc.push(new Set(toks));
      docLen.push(toks.length);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [term, n] of tf) {
        let posting = postings.get(term);
        if (!posting) {
          posting = new Map();
          postings.set(term, posting);
        }
        posting.set(idx, n);
      }
    });

    const total = docLen.reduce((a, b) => a + b, 0);
    this.built = {
      docs: this.docs,
      postings,
      docLen,
      avgLen: docLen.length ? total / docLen.length : 1,
      tokensPerDoc,
      vocab: [...postings.keys()],
    };
  }

  /** Bounded fuzzy lookup, only used when an exact term has no posting. */
  private closeTerms(term: string): string[] {
    const b = this.built;
    if (!b) return [];
    const max = term.length > 5 ? 2 : 1;
    const out: string[] = [];
    for (const v of b.vocab) {
      if (Math.abs(v.length - term.length) > max) continue;
      if (lev(v, term, max) <= max) {
        out.push(v);
        if (out.length >= 6) break;
      }
    }
    return out;
  }

  search(query: string, limit = 8): LyricHit[] {
    const b = this.built;
    if (!b || !b.docs.length) return [];
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];

    const scores = new Map<number, number>();
    const N = b.docs.length;

    for (const qt of qTokens) {
      const posting = b.postings.get(qt);
      const terms = posting ? [[qt, 1] as const] : this.closeTerms(qt).map((t) => [t, 0.55] as const);
      for (const [term, weight] of terms) {
        const p = b.postings.get(term);
        if (!p) continue;
        const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
        for (const [docIdx, tf] of p) {
          const dl = b.docLen[docIdx] ?? 1;
          const denom = tf + K1 * (1 - B + (B * dl) / b.avgLen);
          const s = weight * idf * ((tf * (K1 + 1)) / denom);
          scores.set(docIdx, (scores.get(docIdx) ?? 0) + s);
        }
      }
    }

    const hits: LyricHit[] = [];
    for (const [idx, raw] of scores) {
      const doc = b.docs[idx];
      const toks = b.tokensPerDoc[idx];
      if (!doc || !toks) continue;
      const matched = qTokens.filter((t) => toks.has(t)).length;
      const coverage = matched / qTokens.length;
      hits.push({
        doc,
        score: raw * (0.6 + 0.4 * coverage),
        coverage,
        snippet: snippetFor(doc.lyrics, qTokens),
      });
    }

    hits.sort((x, y) => y.score - x.score);
    return hits.slice(0, limit);
  }
}

/** Find the lyric line with the most query tokens and return it (trimmed) as the result snippet. */
export function snippetFor(lyrics: string, qTokens: string[]): string {
  const lines = lyrics.split(/\r?\n|\. /).filter((l) => l.trim().length > 0);
  let best = '';
  let bestCount = -1;
  for (const line of lines) {
    const toks = new Set(tokenize(line));
    const count = qTokens.reduce((n, t) => n + (toks.has(t) ? 1 : 0), 0);
    if (count > bestCount) {
      bestCount = count;
      best = line.trim();
    }
  }
  return best.length > 140 ? `${best.slice(0, 137)}…` : best;
}

/**
 * Reciprocal rank fusion across independent candidate lists (local index, upstream text search,
 * LRCLIB metadata). Prevents one weak signal from dominating.
 */
export function fuseRanks<T>(
  lists: T[][],
  key: (item: T) => string,
  k = 60,
): Array<{ item: T; score: number }> {
  const scores = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const id = key(item);
      const prev = scores.get(id);
      const add = 1 / (k + idx + 1);
      if (prev) prev.score += add;
      else scores.set(id, { item, score: add });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}
