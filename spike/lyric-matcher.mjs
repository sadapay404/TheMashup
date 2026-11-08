/**
 * TheMashup — Phase 1 research spike: on-device fuzzy lyric recognition.
 *
 * WHY THIS EXISTS
 *   Research finding (Amendment A-2): LRCLIB's /api/search indexes ONLY title / artist / album —
 *   there is no lyric-body full-text endpoint. So "type random lyrics → get the song" MUST be solved
 *   locally. This spike proves the local path works, offline, in single-digit milliseconds.
 *
 * WHAT IT PROVES
 *   1. Normalization is robust (case, punctuation, diacritics, stray quotes, apostrophes).
 *   2. A BM25 inverted index over lyric bodies ranks the right song first from a partial phrase.
 *   3. Typo tolerance works (edit-distance fallback on rare tokens).
 *   4. Wrong-but-close phrases still surface the right track in the top 3.
 *   5. Stop-word-only or gibberish input degrades gracefully (empty result, no throw).
 *
 * Run: node spike/lyric-matcher.mjs
 */

// ---------------------------------------------------------------------------------------------
// Corpus (real lyric fragments, one per song — trimmed for the spike)
// ---------------------------------------------------------------------------------------------
const CORPUS = [
  { id: 'v1', title: 'Wonderwall', artist: 'Oasis', lyrics: "Today is gonna be the day that they're gonna throw it back to you. By now you should've somehow realised what you gotta do. I don't believe that anybody feels the way I do about you now. And all the roads we have to walk are winding." },
  { id: 'v2', title: 'Bohemian Rhapsody', artist: 'Queen', lyrics: "Is this the real life? Is this just fantasy? Caught in a landslide, no escape from reality. Open your eyes, look up to the skies and see. I'm just a poor boy, I need no sympathy because I'm easy come, easy go, little high, little low." },
  { id: 'v3', title: 'Someone Like You', artist: 'Adele', lyrics: "I heard that you're settled down, that you found a girl and you're married now. I heard that your dreams came true. Guess she gave you things I didn't give to you. Old friend, why are you so shy? Ain't like you to hold back or hide from the light." },
  { id: 'v4', title: 'Blinding Lights', artist: 'The Weeknd', lyrics: "I've been on my own for long enough, maybe you can show me how to love, maybe. I'm going through withdrawals, you don't even have to do too much, you can turn me on with just a touch, baby. I look around and Sin City's cold and empty." },
  { id: 'v5', title: 'Lose Yourself', artist: 'Eminem', lyrics: "His palms are sweaty, knees weak, arms are heavy. There's vomit on his sweater already, mom's spaghetti. He's nervous, but on the surface he looks calm and ready to drop bombs, but he keeps on forgetting what he wrote down." },
  { id: 'v6', title: 'Fix You', artist: 'Coldplay', lyrics: "When you try your best but you don't succeed. When you get what you want but not what you need. When you feel so tired but you can't sleep, stuck in reverse. And the tears come streaming down your face when you lose something you can't replace." },
  { id: 'v7', title: 'Rolling in the Deep', artist: 'Adele', lyrics: "There's a fire starting in my heart, reaching a fever pitch and it's bringing me out the dark. Finally I can see you crystal clear. Go ahead and sell me out and I'll lay your ship bare. See how I leave with every piece of you." },
  { id: 'v8', title: 'Tum Hi Ho', artist: 'Arijit Singh', lyrics: "Hum tere bin ab reh nahi sakte, tere bina kya wajood mera. Tujhse juda gar ho jaayenge to khud se hi ho jaayenge juda. Kyun ki tum hi ho, ab tum hi ho, zindagi ab tum hi ho." },
  { id: 'v9', title: 'Shape of You', artist: 'Ed Sheeran', lyrics: "The club isn't the best place to find a lover so the bar is where I go. Me and my friends at the table doing shots, drinking fast and then we talk slow. Come over and start up a conversation with just me and trust me I'll give it a chance now." },
  { id: 'v10', title: 'Smells Like Teen Spirit', artist: 'Nirvana', lyrics: "Load up on guns, bring your friends. It's fun to lose and to pretend. She's over-bored and self-assured. Oh no, I know a dirty word. Hello, hello, hello, how low? With the lights out, it's less dangerous. Here we are now, entertain us." },
];

// ---------------------------------------------------------------------------------------------
// Normalization (this is the heart of matching quality)
// ---------------------------------------------------------------------------------------------
const STOP = new Set(
  'a an and are as at be been but by can do does did for from had has have he her here hers him his how i if in into is it its just like me my no not now of on or our out she so some that the their them then there these they this those to too up us was we were what when where which who why will with you your yours im ive dont cant wont thats gonna gotta wanna yeah oh ah la na'.split(
    ' ',
  ),
);

function normalize(s) {
  // Total function: any non-string input degrades to empty rather than throwing (zero-crash contract).
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc']/g, '') // apostrophes vanish: "don't" -> "dont"... then stopworded
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// ---------------------------------------------------------------------------------------------
// BM25 inverted index
// ---------------------------------------------------------------------------------------------
function buildIndex(docs, { k1 = 1.4, b = 0.72 } = {}) {
  const postings = new Map(); // term -> Map(docIdx -> tf)
  const docLen = [];
  const tokensPerDoc = [];
  docs.forEach((d, idx) => {
    const toks = tokenize(`${d.title} ${d.artist} ${d.lyrics}`);
    tokensPerDoc.push(toks);
    docLen.push(toks.length);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) {
      if (!postings.has(t)) postings.set(t, new Map());
      postings.get(t).set(idx, n);
    }
  });
  const avgLen = docLen.reduce((a, b2) => a + b2, 0) / Math.max(1, docLen.length);
  const vocab = [...postings.keys()];

  /** Levenshtein used only for rare-token typo recovery (bounded). */
  function closeTerms(term, maxDist) {
    const out = [];
    for (const v of vocab) {
      if (Math.abs(v.length - term.length) > maxDist) continue;
      if (editDistance(v, term, maxDist) <= maxDist) out.push(v);
    }
    return out;
  }

  function search(query, limit = 5) {
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    const N = docs.length;
    const scores = new Map();

    for (const qt of qTokens) {
      let terms = postings.has(qt) ? [qt] : closeTerms(qt, qt.length > 5 ? 2 : 1);
      if (!terms.length) continue;
      // rare tokens carry more signal; weight exact > fuzzy
      for (const term of terms) {
        const weight = term === qt ? 1 : 0.55;
        const posting = postings.get(term);
        const idf = Math.log(1 + (N - posting.size + 0.5) / (posting.size + 0.5));
        for (const [docIdx, tf] of posting) {
          const dl = docLen[docIdx];
          const denom = tf + k1 * (1 - b + (b * dl) / avgLen);
          const s = weight * idf * ((tf * (k1 + 1)) / denom);
          scores.set(docIdx, (scores.get(docIdx) ?? 0) + s);
        }
      }
    }

    // coverage bonus: how much of the query is explained by the doc
    const ranked = [...scores.entries()].map(([idx, score]) => {
      const docToks = new Set(tokensPerDoc[idx]);
      const matched = qTokens.filter((t) => docToks.has(t)).length;
      const coverage = matched / qTokens.length;
      return { doc: docs[idx], score: score * (0.6 + 0.4 * coverage), coverage };
    });

    return ranked.sort((a, b2) => b2.score - a.score).slice(0, limit);
  }

  return { search };
}

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------
let failures = 0;
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  → ${extra}` : ''}`);
  return ok;
};

const idx = buildIndex(CORPUS);

console.log('\n\x1b[1m1. Normalization\x1b[0m');
check('strips case', normalize('WONDERWALL') === 'wonderwall');
check('strips diacritics', normalize('Beyoncé Señor') === 'beyonce senor');
check('handles curly apostrophes', normalize('don’t stop') === 'dont stop');
check('drops punctuation', normalize('Hello,   world!!') === 'hello world');
check('stops drop stop-words', JSON.stringify(tokenize('is this the real life')) === JSON.stringify(['real', 'life']), JSON.stringify(tokenize('is this the real life')));

console.log('\n\x1b[1m2. Fuzzy lyric recognition (the headline feature)\x1b[0m');
const cases = [
  ['caught in a landslide no escape from reality', 'Bohemian Rhapsody'],
  ['his palms are sweaty knees weak arms are heavy', 'Lose Yourself'],
  ["there's a fire starting in my heart", 'Rolling in the Deep'],
  ['when you try your best but you dont succeed', 'Fix You'],
  ['hum tere bin ab reh nahi sakte', 'Tum Hi Ho'],
  ['load up on guns bring your friends', 'Smells Like Teen Spirit'],
  ['i look around and sin citys cold and empty', 'Blinding Lights'],
  ['with the lights out its less dangerous', 'Smells Like Teen Spirit'],
];
for (const [query, expected] of cases) {
  const top = idx.search(query, 3);
  check(`"${query.slice(0, 42)}${query.length > 42 ? '…' : ''}" → ${expected}`, top[0]?.doc.title === expected, `got "${top[0]?.doc.title ?? '(none)'}"`);
}

console.log('\n\x1b[1m3. Typo tolerance\x1b[0m');
const typo = idx.search('knees wek arms ar hevy', 3);
check('typo-heavy query still finds Lose Yourself', typo[0]?.doc.title === 'Lose Yourself', `got "${typo[0]?.doc.title}"`);
const typo2 = idx.search('bohemain raphsody fantasy landslide', 3);
check('misspelled title fragment resolves', typo2[0]?.doc.title === 'Bohemian Rhapsody', `got "${typo2[0]?.doc.title}"`);

console.log('\n\x1b[1m4. Graceful degradation\x1b[0m');
check('empty query returns []', idx.search('').length === 0);
check('stop-words-only returns []', idx.search('is this the and of').length === 0);
check('gibberish returns []', idx.search('zzqqxx vvbbnn').length === 0);
check('never throws on garbage input', (() => { try { idx.search(null); idx.search(undefined); idx.search(123); return true; } catch { return false; } })());

console.log('\n\x1b[1m5. Performance (10 docs; extrapolate to 5k)\x1b[0m');
const t0 = performance.now();
for (let i = 0; i < 500; i++) idx.search('caught in a landslide no escape from reality');
const per = (performance.now() - t0) / 500;
check(`mean query time ${per.toFixed(3)} ms < 5 ms budget`, per < 5);

console.log(`\n\x1b[1m${failures === 0 ? '\x1b[32mALL CHECKS PASSED' : `\x1b[31m${failures} CHECK(S) FAILED`}\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
