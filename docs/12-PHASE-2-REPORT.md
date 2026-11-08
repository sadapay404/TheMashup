# TheMashup — Phase 2 Report & Gate G2

> Date: 2026-11-08 · Branch: `arena/2732fac9-themashup`

---

## 1. ⚠️ First: a flag on your Q "Force OAuth with a bundled secret"

You chose it, so I must be straight with you before the report: **I have not shipped a Google OAuth
client secret in the bundle**, and I recommend we never do.

Why, concretely:
- Google's **installed-app device flow requires `client_secret` in the token request**. Putting one in a
  public bundle publishes it to anyone who opens DevTools. Google auto-revokes leaked secrets, and the
  account holder (not us) eats the consequences.
- It is a direct violation of Google's API Services User Data Policy, and it is the exact reason
  InnerTune/OuterTune/ViMusic/Metrolist **all** use cookie capture instead.
- It would break your own C2 ("no secrets in the client").

**What I built instead** (still fully serverless, still gives you account access):
- The real mechanism every mature client uses: **cookie capture + `SAPISIDHASH` request signing**
  (verified from InnerTune source in Phase 1, Amendment A-1).
- Anonymous mode is fully functional *today* in the preview: search, stream, lyrics, downloads.
- Android gets a native login WebView in Phase 3 (clean, no secret).
- Web gets an "advanced: paste your own cookie" path.

**This is your decision to overrule.** If you still want the bundled-secret OAuth attempt, say so and I
will build it next phase with the risks documented in-app. I just will not do it silently.

## 2. What I Built

### 2.1 The portable engine (`packages/core`, zero React, zero platform APIs)
| Module | Contents |
|---|---|
| `innertube/profiles.ts` | 6 client profiles as **data** (Amendment A-3), the token-free stream ladder |
| `innertube/client.ts` | Envelope builder, endpoint facade (`search`, `suggestions`, `browse`, `next`, `player`), verified search-filter protobufs |
| `innertube/parse.ts` | Search/radio/player parsers, format ladder with honest labels. **Total functions** — every one survives hostile input |
| `net/piped.ts` | **Public API provider** (Piped + Invidious) — CORS-enabled by design, so the browser streams with *no relay and no server* |
| `net/transport.ts` | InnerTube transport chain: direct → editable relay ladder, health-checked, circuit-broken |
| `policy/retry.ts` | Jittered backoff, token bucket, circuit breaker (all clock-injectable and tested) |
| `lyrics/*` | Normalizer, LRC parser (multi-timestamp + offset), **BM25 lyric index**, LRCLIB client |
| `recommend/ranker.ts` | Spec-compliant scorer with hard diversity constraints and negative-feedback blocking |
| `util/result.ts` | `Result<T,E>`, a closed error taxonomy, `humanize()` so every error has a sentence and an action |

### 2.2 The app (`apps/web`)
- **Shell**: floating glass nav pill, route transitions, mini-player, full player sheet.
- **The Melt**: mini-player and full player share `layoutId`, so the transition is a real shared-element
  morph; drag is velocity-aware and rubber-banded.
- **Art-derived palette**: canvas median-ish sampler writes `--accent`/`--accent-2`, whole app re-tints.
- **Search**: auto-detects lyric phrases vs titles, shows the mode honestly, debounced, cancellable.
- **Player**: `<audio>` + Web Audio graph (gain → analyser → out), click-free fades, Media Session,
  8-second stall watchdog, per-track resume, generation-guarded loading.
- **Now Playing**: three faces (art / queue / lyrics), karaoke-style synced lyric highlight, seek bar
  with keyboard + pointer support.
- **Download sheet**: shows the real ladder per track, labels every option `stream copy` / `Remux` /
  `Transcode`, marks Premium tiers **locked** instead of hiding or faking them.
- **Settings + Diagnostics**: one-tap probe of direct InnerTube, search route, VISIONOS/TVHTML5 player,
  LRCLIB, and storage persistence — this is what turns Phase 1's `[UNVERIFIED-LIVE]` items into
  something you can confirm yourself.
- **Reliability**: `Boundary` (route-level + panel-level + app-level), unhandled-rejection net,
  diagnostics ring buffer (200 entries, local only).

## 3. Verification (what actually ran)

```
typecheck   tsc --noEmit (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)   → 0 errors
tests       58 passing (51 engine + 7 UI)
build       vite build                                                                    → 147 KB gzip total
dev server  http://0.0.0.0:5173 serving HTML, /src/App.tsx, /src/styles.css                 → 200
```

**Engine tests** cover: envelope correctness per profile, parser totality against 10 hostile inputs × 3
endpoints, Premium-tier locking, cipher reporting, backoff/bucket/breaker maths, LRC parsing,
typo-tolerant lyric matching, recommender diversity + determinism + negative feedback, and error
humanization for all 10 error kinds.

**UI tests** mount the real `App` in jsdom and cover: home render, all four routes, empty states, the
mini-player → full-player transition, unique accessible names, and boundary containment (a crashing
child cannot take down its sibling).

### Bugs the tests caught (and I fixed, in the code — not the test)
1. `parseTrackRow` read fields off the shelf **wrapper** instead of the renderer → every search row
   silently produced no results. Would have shipped as "search finds nothing".
2. Shelf classification read the wrong flex column, so song shelves were misclassified as `mixed`.
3. `looksLikeLyrics` counted content words after stop-words were stripped, so genuine lyric phrases
   ("caught in a landslide no escape from reality") were treated as titles.
4. The recommender's skip penalty was far too weak — an artist you explicitly rejected still ranked
   first. Now negative affinity hard-blocks.

## 4. Honest Limitations (things that will not work as you might hope, yet)

| # | Limitation | Impact | Plan |
|---|---|---|---|
| L1 | **No headless browser in this sandbox.** Chromium download is blocked, so I could not screenshot or run Playwright. | UI is verified by jsdom mount tests + type checks, **not** by a pixel-level visual check. | First thing I do in the next phase: install a browser locally and run visual/E2E assertions. You can also just open the preview. |
| L2 | **Sandbox has no YouTube/LRCLIB egress.** | I cannot prove live streaming from here. | The in-app Diagnostics panel does exactly this on your machine. |
| L3 | Public Piped/Invidious instances are community-run. | Search/stream may fail if all defaults are down. | Ladder tries four; Settings will let you paste your own instance list. Diagnostics names the one that answered. |
| L4 | Web downloads currently **queue** but do not write bytes yet. | Tapping Download shows the honest format ladder and enqueues a job. | Byte-writing + remux lands with the native download service; I did not fake a "completed" state. |
| L5 | Auth on web is not wired to a real cookie paste UI yet. | Anonymous mode only, for now. | Small addition; do it alongside Phase 3 auth. |

## 5. Extra Features Landed Ahead of Schedule
From the Phase 1 backlog: **E20 Diagnostics probe**, **E21 art-derived palettes + AMOLED black**,
**E1 synced/karaoke lyrics**, **E15 "Why this track?"**, **E13 gesture suite (part)**, plus the
lyric-phrase detection and mode banner.

## 6. Gate G2

Phase 2's core is complete and verified to the extent this sandbox allows. Two things I recommend
before I move to Android: (a) you open the preview and confirm it feels right, (b) I close L1 by
getting a real browser for visual regression.

**I am stopping here. No Phase 3 code will be written until you say go.**
