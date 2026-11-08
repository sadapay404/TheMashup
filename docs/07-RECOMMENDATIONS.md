# TheMashup — On-Device Recommendation Engine Spec

> **Phase 1 deliverable — Document 7 of 10**

---

## 1. Problem

YouTube Music's radio is a server-side model. With no server we must reproduce its *behaviour*, keep it
explainable, and keep it cheap enough to run in ~4 ms on a mid-range phone.

## 2. Signals Available

| Signal | Source | Cost | Quality |
|---|---|---|---|
| S1 Structural | `next` → `playlistPanelVideoRenderer[]` (up to 25, upstream-ranked) | 1 request, prefetched | High (that *is* YT's algorithm) |
| S2 Artist affinity | local play events | free | Medium |
| S3 Track affinity | local play events | free | Medium |
| S4 Co-occurrence graph | local transitions (A→B) | free | Medium-High once warm |
| S5 Recency/novelty | timestamps | free | — |
| S6 Explicit feedback | like / "less like this" / skip | free | High |

No signal is used alone. The engine is a **ranker over S1's candidate pool**.

## 3. Model

### 3.1 Candidate generation
```
pool = next(seed).tracks                       // 25
     ∪ graph.neighbours(seed.artist, k=12)     // local co-occurrence
     ∪ affinity.topArtists(3).recentTracks(2)  // taste anchor
pool = dedupe ∩ notRecentlyPlayed(30 min)
```

### 3.2 Scoring
```
score(t) = 0.50·S1rank(t)          // 1 - rank/25
         + 0.22·affinity(t.artist)
         + 0.10·graphProx(seed, t)
         + 0.08·trackAffinity(t)
         + 0.10·novelty(t)          // e^(-daysSinceArtistPlayed/14)
         − 0.35·skipPenalty(t)
```

`affinity` and `trackAffinity` are EWMA with a 14-day half-life, normalized to [0,1] per user by the
observed max (so a light user and a heavy user both get a usable spread).

### 3.3 Selection constraints (hard, not soft)
- ≤ 2 consecutive tracks from the same artist.
- No track repeat within 40 played tracks (or until pool exhaustion).
- ≤ 1 track from the last 5 **when the user has skipped ≥ 2 in the last 6** (frustration detector).
- ε-greedy: with p = 0.12, draw from rank 8–25 instead of the top 3, so discovery never stops.

### 3.4 Exploration budget
A session exposes a "Discovery" slider (0 = familiar, 1 = adventurous) mapping to ε ∈ [0.02, 0.35] and to
the novelty weight. Persisted per user. Default 0.12.

## 4. Learning from Behaviour

| Event | Update |
|---|---|
| play ≥ 30 s | `artistAffinity += 1.0·w`, `trackAffinity += 1.0·w`, `graph(seed→t) += 1` |
| complete ≥ 90 % | extra `+0.5` |
| skip < 5 s | `artistAffinity −= 0.6·w`, `trackAffinity −= 0.6·w`, frustration +1 |
| skip 5–30 s | `−= 0.25` |
| like | `+= 2.0`, and artist `+= 0.5` |
| unlike | `−= 2.0` |
| "less like this" | artist blocked for 7 days |
| manual queue add | `+= 1.5` (strong intent) |
| repeat within 24 h | recency boost `×1.3` for 7 days |

`w = 1 / (1 + sessionPlayIndex/10)` — later plays in a long session count slightly less (fatigue damp).

## 5. Cold Start
1. No history → **structural only** (S1) with ε = 0.20.
2. First run offers "Import taste": paste a YT Music playlist / album / liked-songs URL → fetch items →
   seed affinities at 0.5 weight.
3. After 10 played tracks the local signals become dominant; S1 weight decays from 0.70 → 0.50.

## 6. Explainability
Every queue item carries `why: {source, score, factors}`. Long-press → "Why this track?" shows
`Because you played <artist>` / `From <seed> radio` / `New for you`. This is also the debugging surface
for tuning, and it is genuinely useful to users — YT Music never explains itself.

## 7. Storage & Performance

```ts
// IndexedDB, Dexie table `affinity`
{ key: "artist:<id>", value: number, lastUpdated: epochMs }
// table `graph`  (bounded)
{ from: artistId, to: artistId, w: number, lastUpdated: epochMs }
// table `events` (ring buffer, last 5000)
{ ts, videoId, artistId, type, msPlayed, sessionId }
```
- Graph capped at 512 nodes × 32 edges, pruned by weight on idle (`requestIdleCallback`).
- **Ranking budget: < 4 ms** for 25 candidates. Everything is typed arrays + plain objects; no allocation
  in the hot loop, no `Array.prototype.sort` on objects (index sort on a `Float32Array`).
- Deterministic RNG (xorshift128 seeded per session) → the same seed + history yields the same queue,
  which is what makes the property tests possible.

## 8. Test Plan (property-based, `fast-check`)
| Property | Assertion |
|---|---|
| P1 | Never 3 consecutive tracks by one artist |
| P2 | Never the same videoId twice within 40 |
| P3 | Queue is a permutation of a subset of the generated pool (no invented ids) |
| P4 | With ε = 0, output is monotonically non-increasing in score |
| P5 | Empty history never throws and always yields ≥ 10 candidates given a healthy pool |
| P6 | Hostile input (NaN weights, 10⁵ events, duplicated ids) never throws |
| P7 | Determinism: same seed ⇒ identical queue |

## 9. Future (v2, still serverless)
- Tiny logistic-regression re-ranker trained **on device** from local events (12 features, SGD, ~2 KB).
- Session-aware transitions (avoid abrupt genre jumps using graph distance as a penalty).
- Time-of-day affinity buckets (morning commute vs. late night).
