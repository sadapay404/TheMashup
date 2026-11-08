# TheMashup — Caching, Storage & Zero-Crash Architecture

> **Phase 1 deliverable — Document 8 of 10**

---

## 1. Storage Tiers

| Tier | Tech | Budget | Contents | Eviction |
|---|---|---|---|---|
| **T0 Memory** | LRU `Map` | ≤ 24 MB | last 40 parsed payloads, current queue, art bitmaps | immediate, on route change |
| **T1 Metadata** | IndexedDB (Dexie 4) | ≤ 60 MB | tracks, albums, artists, playlists, affinity, graph, events | oldest-first, never user data |
| **T2 Lyrics index** | IndexedDB (MiniSearch blob) | ≤ 40 MB | normalized lyric docs + inverted index | rebuilt, never fatal |
| **T3 Media cache** | OPFS (web) / app-private dir (Android) | ≤ 2 GB | recently streamed + prefetched audio | LRU, **never completed downloads** |
| **T4 Downloads** | OPFS / SAF / Downloads | unlimited (user's disk) | user-requested files | **never**; only explicit delete |
| **T5 Secure** | Keystore / AES-GCM IDB | tiny | session cookies, account label | on sign-out |

`navigator.storage.persist()` is requested at first download. `estimate()` is surfaced in Settings with a
"why is my storage full" breakdown per tier. On Android, downloads default to app-private storage and can
be re-targeted to a user-chosen SAF folder.

## 2. Cache-Key Strategy

```
key = sha1( endpoint | profileName | locale | gl | authState | payloadHash )
ttl = search 10 min · suggestions 5 min · browse 30 min · next 15 min · player 0 (never cached, re-resolve)
```
**Player responses are never cached as URLs** (they expire and are IP/client-bound) — only the *parsed
format descriptor* is kept for the download UI, tagged with `expiresAt` from `expiresInSeconds`.

## 3. IndexedDB Schema (Dexie, versioned + migratable)

```ts
db.version(1).stores({
  tracks:      'id, artistId, albumId, title, plays, lastPlayed',
  albums:      'id, artistId, year',
  artists:     'id, name, affinity',
  playlists:   'id, kind, updatedAt',
  lyrics:      'trackKey, hasWordSync, fetchedAt',
  lyricIndex:  'id',                       // serialized MiniSearch
  affinity:    'key, lastUpdated',
  graph:       'from, w',
  events:      '++seq, ts, videoId, artistId, type',
  downloads:   'id, state, createdAt',
  meta:        'key'
});
```
Migrations are forward-only with a `db.on('versionchange')` guard and a **schema-version handshake**:
if the stored version is newer than the app's, the app enters read-only safe mode instead of corrupting.

## 4. Error Taxonomy (the whole surface, closed set)

```ts
type AppError =
  | { k: 'Network';    retryable: true;  status?: number; cause: 'offline'|'timeout'|'dns'|'reset' }
  | { k: 'Cors';       retryable: true;  relayTried: string[] }
  | { k: 'Upstream';   retryable: boolean; endpoint: string; status: number; bodySample?: string }
  | { k: 'Parse';      retryable: false; endpoint: string; path: string; sample?: string }
  | { k: 'Auth';       retryable: false; reason: 'expired'|'missing'|'revoked' }
  | { k: 'Playability';retryable: false; status: 'UNPLAYABLE'|'LOGIN_REQUIRED'|'AGE_RESTRICTED'|'GEO' }
  | { k: 'Storage';    retryable: false; reason: 'quota'|'denied'|'corrupt' }
  | { k: 'Capability'; retryable: false; missing: 'opfs'|'webcrypto'|'mediaSession'|'ffmpeg' }
  | { k: 'Cancelled';  retryable: false }
  | { k: 'Unknown';    retryable: false; fingerprint: string };
```
Every error has a **user-facing sentence** and a **next action** (retry / switch relay / sign in / free
space / open settings). No raw stack traces reach the UI; they go to the diagnostics ring buffer.

## 5. Retry / Backoff / Circuit Breaker

```
attempt n: delay = min(30s, 400ms · 2^n) · (0.7 + 0.6·rand)   // full jitter
max attempts: 4 (player: 3, then next profile in ladder)
retry only if err.retryable
```
- **Token bucket** per endpoint: `search` 8/min burst 4, `next` 20/min, `player` 30/min.
- **Circuit breaker** per (endpoint, profile): 5 failures in 60 s → open 5 min → half-open probe.
- **Stall watchdog**: `playing` but no `timeupdate` for 8 s → re-resolve stream once, then surface
  `Playability` with a "try another source" action.

## 6. Safe-Mode Boot

```
boot()
 ├─ read meta.lastGoodBoot
 ├─ if previous boot did not reach `ready` within 5 s twice in a row
 │    → SAFE MODE: animations off, network off, cached library + downloads only,
 │      banner with [Retry normal boot] [Export diagnostics] [Reset local data]
 ├─ else normal boot
 └─ after successful `ready`, write meta.lastGoodBoot = now (debounced 2 s)
```
A crash loop can therefore never brick the app.

## 7. React Boundary Layout

```
<RootBoundary>                     ← last resort, offers diagnostics export
  <SafeModeGate>
    <RouterBoundary per route>     ← keeps nav usable if a screen dies
      <PanelBoundary>              ← player / queue / search each isolated
        <Suspense skeleton>
          <Screen/>
```
Each boundary logs `{ componentStack, route, appVersion, errorFingerprint }` to the ring buffer (last
200, PII-free, exported only on demand).

## 8. Persistence of Playback (auto-recovery)

Every 5 s (and on `visibilitychange → hidden`, `pause`, `trackchange`) write:
`{ queue, index, positionMs, repeatMode, shuffle, volume, rate, updatedAt }` to `meta.playback`.
On boot: restore if `updatedAt < 7 days`, show "Resume where you left off" — never auto-play (respect
autoplay policy and user surprise).

## 9. Performance Guardrails

| Guard | Mechanism |
|---|---|
| No layout thrash | animations restricted to `transform`/`opacity`/`filter`; enforced by a lint rule on `motion` props |
| Virtualized lists | `@tanstack/react-virtual` above 50 rows |
| Image safety | `createImageBitmap` at display size, `decoding=async`, WH variants chosen from YT thumb sizes, `srcset` |
| Bundle discipline | route-level `lazy`, `size-limit` gate in CI, ffmpeg.wasm only on first transcode |
| Memory ceiling | T0 LRU cap + `FinalizationRegistry` audit in dev build; heap alert in debug HUD |
| Interaction budget | long task observer; dev-only warning when a handler > 50 ms |

## 10. Diagnostics (user-verifiable, because this sandbox cannot reach the network)
Settings → Diagnostics → **"Run probe"** executes the live checks and prints a pass/fail table:
`visitorData fetch · WEB_REMIX search · VISIONOS player · TVHTML5 player · 140/251 stream HEAD ·
LRCLIB get/search · CORS on each relay · storage persist · ffmpeg availability`.
This converts every **[UNVERIFIED-LIVE]** claim in the docs into something you can confirm in 3 seconds
on real hardware.
