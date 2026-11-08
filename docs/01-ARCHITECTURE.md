# TheMashup — System Architecture Blueprint

> **Document 1 of 5 — Phase 0 deliverable**

---

## 1. Architectural Spine

TheMashup is built as a **layered, shell-agnostic monorepo**. The single most important rule:

> **`packages/core` knows nothing about React, nothing about Capacitor, nothing about the DOM.**

This is what makes "write once, run on web + Android + Windows" real instead of decorative. Each
platform supplies three things and only three things: a **transport**, a **storage driver**, and a
**playback sink**. Everything above that is identical code.

```
                    ┌──────────────────────────────────────┐
                    │  Shells: web (Vite) · android (Cap)   │
                    │          · windows (Tauri, later)     │
                    └───────────────┬──────────────────────┘
                                    │ implements
        ┌───────────────┬───────────┴────────┬──────────────────┐
        ▼               ▼                    ▼                  ▼
  TransportPort   StoragePort        PlaybackSink       NotificationPort
  (fetch/relay)   (IDB/OPFS/FS/SAF)  (WebAudio/Media3)  (Web Notif/NotificationCompat)
```

### 1.1 Port contracts (frozen in Phase 1, code in Phase 2)

| Port | Responsibility | Web impl | Android impl |
|---|---|---|---|
| `TransportPort` | HTTP GET/POST with headers, abort, progress | `fetch` + relay chain | Capacitor HTTP (native, no CORS) |
| `StoragePort` | KV + blob storage, quota, persist | IndexedDB (Dexie) + OPFS | Capacitor Filesystem + SAF |
| `PlaybackSink` | set source, play/pause/seek/rate, emit state | `HTMLAudioElement` + Web Audio | Media3 `ExoPlayer` via plugin |
| `NotificationPort` | show/update media notification | Media Session API | `MediaSessionService` |
| `SecureStorePort` | store OAuth refresh token | encrypted IndexedDB record | Android Keystore-backed store |
| `ExtractorPort` | resolve stream formats (fallback) | relay / direct player call | NewPipe-class Kotlin bridge |

Every port is **capability-detected at boot** and injected via React context. A missing capability
disables a feature with a visible, explained state — it never throws.

---

## 2. Module Map (target monorepo)

```
themashup/
├── apps/
│   ├── web/                     # React 19 + Vite shell  ← preview target
│   └── android/                 # Capacitor shell + Kotlin plugins (Phase 3)
├── packages/
│   ├── core/                    # ★ pure TS: youtubei, lrclib, schemas, policy
│   │   ├── src/innertube/
│   │   │   ├── client.ts        # request envelope, client profiles
│   │   │   ├── profiles.ts      # WEB_REMIX / ANDROID_MUSIC / IOS / TVHTML5
│   │   │   ├── endpoints/       # search, browse, next, player, suggestions
│   │   │   ├── parse/           # renderer → domain mappers (Zod-guarded)
│   │   │   └── sig/             # cipher + n-sig strategies
│   │   ├── src/lyrics/          # LRCLIB client, normalizer, inverted index, BM25
│   │   ├── src/recommend/       # seed → queue heuristics, co-occurrence graph
│   │   ├── src/download/        # format ladder, range-chunk planner
│   │   ├── src/policy/          # retry, backoff, circuit breaker, rate limiter
│   │   ├── src/result.ts        # Result<T,E> — the app never throws at a boundary
│   │   └── src/ports/           # the six port interfaces above
│   ├── ui/                      # design system: tokens, primitives, motion
│   ├── state/                   # zustand stores + persistence middleware
│   └── playback/                # queue machine, gapless logic, sink-agnostic
├── docs/                        # this blueprint set
└── tooling/                     # eslint, tsconfig base, scripts
```

### 2.1 Dependency direction (enforced by `eslint-plugin-boundaries`)

```
ui ──▶ state ──▶ playback ──▶ core ──▶ ports
                   │                      ▲
                   └──────── shells ──────┘   (shells implement ports; core never imports shells)
```

Any import going the wrong way fails lint **and** CI. This is the single guard that keeps the
"serverless, shell-agnostic" promise from rotting over months.

---

## 3. Data Flow: "User types lyrics → song plays"

The most complex flow in the app, spelled out end-to-end because it exercises every layer.

```
1  keystroke
   └─▶ SearchBar (debounced 180 ms, IME-safe)
2  classify input
   ├─ matches "Artist - Title" shape?      → direct suggestion path
   ├─ >12 tokens or contains lyric cues?   → LYRIC PATH
   └─ else                                 → unified path (both in parallel)
3  LYRIC PATH — all on device
   ├─ normalize: lowercase, strip diacritics/punctuation, collapse whitespace
   ├─ tokenize → stopword filter → bigram index lookup (IndexedDB, inverted)
   ├─ BM25 score candidates → top 8 track candidates (id, title, artist, snippet)
   └─ enrich via youtubei/search (title+artist) to hydrate art + durations
4  fallback ladder (only if step 3 yields < 3 candidates)
   ├─ youtubei/search type=song for the raw lyric string (YouTube's own text match)
   └─ LRCLIB `/api/search?q=` full-text → map to candidate titles → hydrate
5  user picks → Queue Machine
   ├─ queue = [picked] ++ recommender.expand(seed=picked, n=24)
   └─ prefetch next 2 tracks' player responses
6  Playback Orchestrator
   ├─ playerResponse = innertube.player(videoId, profileLadder)
   ├─ select best audio format by user's quality ceiling
   ├─ PlaybackSink.load(url)  ──▶ Media3 (android) | <audio> (web)
   └─ arm: circuit breaker, stall watchdog, position persistence (every 5 s)
7  NotificationPort.update({ title, artist, art, position })
```

Every numbered step returns `Result<T, AppError>` and is individually observable in the debug HUD
(toggle in settings, ship-disabled).

---

## 4. Recommendation Engine (client-side, no server)

YouTube Music's radio is a server-side model we cannot call parameter-for-parameter. We reproduce its
*behaviour* with three composable local signals:

1. **Seed expansion (structural).** `next(videoId, radioPlaylistId)` returns up to 25
   `playlistPanelVideoRenderer` items — this *is* an algorithmic radio, computed upstream and free.
   We treat it as the base distribution and re-rank locally.
2. **Behavioural affinity (local).** Every completed ≥30 s listen increments:
   `artistAffinity[artist] += w`, `trackAffinity[id] += w`, and co-occurrence edges
   `edge(seedArtist, playedArtist) += w` in a bounded graph (top 512 artists, pruned nightly by
   weight). Stored in IndexedDB.
3. **Exploration policy (local).** Re-rank the candidate pool with
   `score = 0.55·structuralRank + 0.30·affinity + 0.15·novelty`, then ε-greedy sample
   (ε=0.12) so the queue never collapses into a loop. A diversity constraint
   (≤2 consecutive tracks per artist) is enforced in the queue machine, not the scorer.

Cold start: no history → structural only. Import from a YouTube Music playlist URL → pre-seed affinity.
Skips are penalized (`w = -0.6·listenWeight`); repeat plays are recent-taste boosted with a 14-day
half-life.

**Deterministic replay:** the RNG is seeded per session, so "why this track" is reproducible and
testable in CI (property tests assert no artist >2× consecutive, no immediate repeat).

---

## 5. Download Engine

```
resolve formats (player response)
  └─▶ build ladder → user picks rung (audio: 48/64/128/160/256 · video: 144p…2160p)
       └─▶ HEAD → accept-ranges? content-length?
            ├─ ranges OK → N=4 parallel Range requests (backoff per chunk) → concat → verify size
            └─ no ranges → single streamed request with progress + resume token
                 └─▶ remux/transcode (only if user asked for MP4/MP3/FLAC)
                      ├─ Web:  ffmpeg.wasm worker (OPFS scratch → final blob)
                      └─ Android: FFmpegKit native, SAF output
                           └─▶ write to StoragePort → emit completion → update Library
```

- **Queue:** max 2 concurrent jobs (3 on Wi-Fi-and-charging), persisted across relaunch; a job is a
  state machine (`queued → resolving → downloading → muxing → done | failed(reason)`) so a killed app
  resumes exactly where it stopped.
- **Integrity:** expected byte length compared to received; mismatch = auto-retry once, then
  `PARTIAL` state with a one-tap resume.
- **Never lose user data:** completed downloads live outside the LRU cache and are excluded from
  eviction. Deleting requires explicit user action with undo (10 s snackbar).

---

## 6. Performance Budgets

| Metric | Budget | Measurement |
|---|---|---|
| Shell JS (gzip) | ≤ 180 KB | `size-limit` in CI |
| Route chunk (gzip) | ≤ 90 KB | `size-limit` |
| First Contentful Paint (mid Android, 4G) | ≤ 1.8 s | Lighthouse CI |
| Interaction → visual feedback | ≤ 100 ms | manual rubric (motion spec §5) |
| Animation frame time | ≤ 16.6 ms | Chrome trace, no `layout` in animation frames |
| Long tasks during scroll | 0 > 50 ms | `PerformanceObserver` in debug HUD |
| Heap after 30 min playback | < 180 MB, flat | Android Studio profiler (Phase 3) |
| Idle CPU while playing audio, screen off | < 2 % | `dumpsys` (Phase 3) |

Enforced by: route-level `React.lazy`, `virtual` lists for any list > 50 items, `content-visibility`
on off-screen cards, image decode via `createImageBitmap` at display size, and zero animation of
layout-triggering properties (only `transform`/`opacity`/`filter`).

---

## 7. Reliability Architecture ("zero-crash" in practice)

Four concentric rings; a failure must clear all four to reach the user.

1. **Total functions.** `packages/core` returns `Result`. Exceptions are converted at the boundary.
   `no-floating-promises`, `no-throw-literal`, `strict` — all lint errors.
2. **Schema firewall.** Every upstream payload passes Zod. Unknown fields are ignored; missing
   required fields produce `ParseError{ endpoint, path, sample }` (sampled, PII-free) — never a crash.
3. **React boundaries.** Per-route `ErrorBoundary` + per-panel boundary. A failed download list cannot
   take down the player.
4. **Process boot guard.** Last-known-good state is written before risky operations
   (`safeMode` flag in `localStorage`). If two consecutive boots fail within 5 s, the app boots into
   **Safe Mode**: animations off, network off, cached library only, and a "reset local data" action.

Plus: a **watchdog** on playback (no `timeupdate` for 8 s while `playing` → auto re-resolve stream),
and a **global unhandledrejection** listener that logs to the on-device ring buffer (last 200 events,
viewable + exportable in Settings → Diagnostics).

---

## 8. Security & Privacy Posture

- OAuth tokens stored in `SecureStorePort`; web uses non-extractable AES-GCM with a key in IndexedDB
  (honest limitation: a web app cannot protect against a compromised origin — documented in-app).
- No analytics, no telemetry, no third-party scripts. The Diagnostics export is user-initiated only.
- All upstream calls are the *user's own* session; no shared proxy credentials are bundled.
- CSP for the web build: `default-src 'self'; connect-src https://music.youtube.com https://*.googlevideo.com https://lrclib.net <relay-list>; img-src 'self' https: data:; media-src https://*.googlevideo.com blob:`.
- Downloads directory is app-scoped on Android (`SAF` on explicit user choice), never a global write.
