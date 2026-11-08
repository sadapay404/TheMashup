# TheMashup — Phase 1 Report & Gate G1

> Date: 2026-11-08 · Branch: `arena/2732fac9-themashup`

---

## 1. What Phase 1 Was Supposed To Do
Deep technical research + a frozen API strategy, so Phase 2 is execution rather than exploration.

## 2. Method (and its honest limitation)

**Sandbox egress is restricted** to `github.com`, `codeload.github.com`, `api.github.com`,
`registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`. I verified this — `music.youtube.com`,
`lrclib.net` and Piped instances all return `000`. So I did **not** fabricate live probe results.
Instead I read the *implementation source* of the projects that make these calls daily:

| Source | What I read | Why it is authoritative |
|---|---|---|
| `yt-dlp/yt-dlp` @ master | `extractor/youtube/_base.py` → `INNERTUBE_CLIENTS` profile table + PoToken policies | Patched within days of every upstream change; the de-facto reference |
| `z-huang/InnerTune` | `innertube/…/InnerTube.kt`, `YouTubeClient.kt`, `LoginScreen.kt` | The app OuterTune is forked from — the *actual* auth + signing implementation |
| `tranxuanthang/lrclib` @ main | `server/src/router.rs`, `routes/search_lyrics.rs`, `search_index/query.rs` | The real LRCLIB server, not its README |
| `LuanRT/YouTube.js` | `core/Player.ts`, `types/Misc.ts` | Current n-sig/cipher + client enum handling |
| `ytmusicapi` 1.12.3 (PyPI) | `parsers/search.py`, `mixins/*`, `helpers.py` | The most complete YTM Music-specific endpoint map |

## 3. Deliverables

| File | Contents |
|---|---|
| `docs/00a-DECISIONS-LOG.md` | Gate answers + **5 research amendments (A-1…A-5)** |
| `docs/06-API-STRATEGY.md` | 12-endpoint catalogue, request anatomy, profile matrix, filter protobufs, lyrics pipeline, format ladders, auth contract, drift defence |
| `docs/07-RECOMMENDATIONS.md` | Scoring model, weights, hard selection constraints, learning table, cold start, storage schema, 7 property tests |
| `docs/08-STORAGE-RELIABILITY.md` | 6 storage tiers, cache keys, Dexie schema, closed error taxonomy, retry/breaker, safe-mode boot, persistence, perf guardrails, diagnostics probe |
| `docs/09-DOWNLOAD-ENGINE.md` | Honest capability matrix, why no COOP/COEP, job state machine, range transport, naming, tagging, 7-case test matrix |
| `docs/10-BACKLOG.md` | Brief features + **24 extra features** with effort/phase + explicitly rejected items |
| `spike/innertube-probe.mjs` | Runnable contract prover — **41 checks** |
| `spike/lyric-matcher.mjs` | Runnable fuzzy-lyrics prover — **22 checks** |

## 4. Verified Results (actually executed here)

```
$ node spike/innertube-probe.mjs   →  ALL CHECKS PASSED   (41 checks)
$ node spike/lyric-matcher.mjs     →  ALL CHECKS PASSED   (22 checks)
```

What the probes prove:

- **Request envelopes** correct for 4 client profiles (URL, `X-YouTube-Client-Name` ↔ body consistency,
  `visitorData` propagation, `x-origin`).
- **Parsers** extract search results (videoId, title, artist, duration, continuation), the `next` radio
  panel, and `RDAMVM<videoId>` ids.
- **Format ladder** identifies 251 (Opus ~160 k) as the best *free* audio, marks 141 as Premium-locked,
  dedupes video by resolution, detects 4K and progressive itag 18.
- **Honest labels** — FLAC = "lossless container, lossy source"; MP3 = TRANSCODE; MP4 = REMUX.
- **Defensive parsing** — `null`, garbage, missing `streamingData`, cipher-only formats all degrade
  without throwing.
- **Fuzzy lyrics** — 8/8 real fragments resolve offline; typos work ("knees wek arms ar hevy" →
  Lose Yourself); gibberish returns `[]`; **0.010 ms** mean query.

## 5. Five Findings That Changed The Plan

| # | Finding | Impact |
|---|---|---|
| **A-1** | OAuth device-code flow **requires a client secret** → not shippable. Real clients use **WebView cookie capture + `SAPISIDHASH` signing**. | Auth design replaced. Web gets a labelled "paste cookie (advanced)" path; Android gets a native login WebView. **Your requested full write access is achievable — via cookies, not OAuth.** |
| **A-2** | **LRCLIB cannot search lyric text.** Its index covers title/artist/album only (read from `search_index/query.rs`). | Fuzzy lyrics must be **local-first** (BM25 index) + corpus warm-up + upstream text fallback. My Phase 0 assumption was wrong; corrected. |
| **A-3** | Client `clientVersion` strings rot constantly. `WEB_REMIX` is `1.20260707.12.00` today; InnerTune still has `1.20220606.03.00` baked in. | Profile table becomes **data** (`compat/profiles.json`) with optional remote refresh + user override. No app update needed when YouTube bumps a version. |
| **A-4** | `VISIONOS` and `TVHTML5` declare **no GVS PoToken policy** (yt-dlp source); `WEB_REMIX`/`WEB`/`MWEB` require one. VISIONOS also returns **cipher-free** URLs. | **Role split**: metadata via `WEB_REMIX`, **streams via VISIONOS/TVHTML5**. Keystone of the serverless design. |
| **A-5** | `ytmusicapi`'s `signatureTimestamp` is a date hack it explicitly warns about. | Extract the real value from player JS, cached 24 h; PoToken-free clients rarely need it. |

Plus a download finding: **ffmpeg.wasm's multi-threaded core needs COOP/COEP**, which would break the
CORS relay chain playback depends on → web uses **single-threaded core for audio transcode only** +
pure-JS **remux** (`mp4box.js`) for video (`09 §2`).

## 6. Honest Gate Status

Gate G1 required *"a runnable probe script proves search + stream URL resolution."* I can prove the
**search and stream-resolution logic** (envelope + parse + ladder) — both spikes pass. I **cannot** prove
live upstream behaviour from here, because YouTube and LRCLIB are blocked in this sandbox. I will not
dress up fixtures as live data.

**Mitigation, already designed:** the **Diagnostics Probe** (E20 / `08 §10`) runs the real checks in one
tap on your device and prints pass/fail for `visitorData`, `WEB_REMIX` search, `VISIONOS`/`TVHTML5`
player, `140`/`251` HEAD requests, LRCLIB get/search, relay CORS, storage persist, ffmpeg availability.
Gate G1 becomes verifiable for real as soon as Phase 2 produces a preview.

## 7. Gate G1

Phase 1 is complete: the API strategy is frozen, the endpoint/format/profile tables are built from
source-verified data, and both spikes pass.

**I am stopping here. No Phase 2 code will be written until you say go.**
