# TheMashup — Technology Stack & Architecture Decision Records

> **Document 2 of 5 — Phase 0 deliverable**

---

## 1. Stack Summary

| Layer | Choice | Version target | Why this and not the alternative |
|---|---|---|---|
| Language | **TypeScript** | 5.7+ | `strict` + `noUncheckedIndexedAccess`; the only sane way to model `Result` and Zod-built domain types. |
| Web framework | **React 19** | 19.x | Concurrent features (`useTransition`, `useOptimistic`) give the "butter-smooth" feel — search and queue updates never block the player thread. |
| Bundler / dev | **Vite 6** | 6.x | Sub-second HMR, native ESM, trivial static output (satisfies *zero hosting*). Next.js rejected: its server components/route handlers invite a server, violating C1. |
| Styling | **Tailwind CSS v4** | 4.x | CSS-first `@theme` tokens, no config file, tiny runtime, plays perfectly with CSS variables for theming. |
| Motion | **Motion (Framer Motion) 12** + **CSS Houdini-free spring vars** | 12.x | Layout animations, drag physics, shared-element via `layoutId`. `motion/react` tree-shakes to ~18 KB. |
| Client state | **Zustand 5** + custom persistence | 5.x | Tiny, no provider tree, selectors prevent re-render storms; ideal for a 60 fps player. Redux rejected (weight), Jotai rejected (queue machine is a single coherent machine). |
| State machine | **XState 5** (queue + downloads only) | 5.x | Illegal states made unrepresentable; the download job and the playback queue are genuinely stateful protocols. |
| Validation | **Zod 4** | 4.x | Schema firewall (see Architecture §7.2). |
| Persistence | **Dexie 4** (IndexedDB) + **OPFS** via `navigator.storage` | — | Metadata/graph/lyrics index in Dexie; media blobs in OPFS (no 5 MB-per-item IDB limit). |
| Search index | **MiniSearch 7** | 7.x | In-memory inverted index with BM25, prefix + fuzzy matching, serializable to IndexedDB. 15 KB. Replaces a hand-rolled scorer with something actually correct. |
| Audio (web) | `HTMLAudioElement` + **Web Audio API** graph | — | Element API is the only path that keeps the tab alive and supports Media Session; the AudioContext graph adds crossfade, gapless and EQ. |
| Remux/transcode | **ffmpeg.wasm** (web) / **FFmpegKit** (Android) | — | Client-side only; heavy module lazy-loaded on first download, never in the shell bundle. |
| Native shell | **Capacitor 7** | 7.x | Keeps one React codebase; first-class Kotlin plugin authoring (we need real Media3 + extractor). React Native rejected: we'd rewrite the entire UI and lose the web preview; Flutter rejected: same, and Dart kills code reuse with `packages/core`. |
| Android audio | **AndroidX Media3** `ExoPlayer` + `MediaSessionService` | 1.4+ | The LibreTube/OuterTune-proven stack: background playback, lockscreen, media keys, notifications for free. |
| Android extractor bridge | **NewPipe Extractor** (optional, Kotlin) | latest | Only needed when InnerTube URL resolution fails; isolates AGPL/GPL surface behind a plugin. |
| Desktop (Phase 4) | **Tauri 2** | 2.x | Reuses the same web bundle, native HTTP (no CORS), ~8 MB installer vs Electron's 120 MB. Electron rejected on footprint and RAM. |
| Testing | **Vitest** + **Testing Library** + **Playwright** + **fast-check** | — | Unit, component, E2E, and property-based tests (the recommender and queue machine are property-tested). |
| Quality | ESLint 9 flat config, `eslint-plugin-boundaries`, `size-limit`, Lighthouse CI, `knip` | — | Enforces the architecture in §2.1 and the budgets in Architecture §6. |
| CI | **GitHub Actions** — build + test + artifact upload | — | Artifacts, *not* deployments. Preserves C1/C2. |

---

## 2. Architecture Decision Records

### ADR-001 — No backend, ever; "relay" is a ranked public list, not our server
**Context.** Browsers cannot call `music.youtube.com` directly (CORS). A backend proxy is the obvious
fix and is explicitly forbidden by C1/C2.
**Decision.** Introduce `TransportPort` with an adapter chain:
`native-http → direct-fetch (works in Tauri/Capacitor) → public-relay(ladder)`.
The relay ladder is a **user-editable, ordered list of public CORS relays** (default: two well-known
open-source Piped/Invidious-style instances plus a `data:`-free "none" option), each probed for
health at boot and demoted on failure. The list ships as a config file the user can replace.
**Consequences.** Web-only mode has a third-party dependency for *transport* (not for data or
accounts) and may be slower. Native builds (Android/Windows) bypass relays entirely and are the
recommended path. The app is fully functional with zero relays for search-on-cache and lyrics.

### ADR-002 — Capacitor over React Native
**Context.** Phase 2 requires a real, previewable web app; Phase 3 requires a real APK.
**Decision.** Capacitor. One codebase, one design system, native Kotlin where it matters (Media3,
downloader, extractor).
**Consequences.** We must write our own bridges for background audio — acceptable, and it's *better*
than a JS-only player because Media3 owns the service lifecycle. Risk: WebView version variance on
old devices → minimum SDK 26 (Android 8), verified matrix in Phase 3.

### ADR-003 — `Result<T, E>` instead of exceptions at module boundaries
**Context.** "Zero crash" is a requirement, not an aspiration.
**Decision.** Every function in `packages/core` that can fail returns `Result`. Exceptions survive only
inside leaf functions and are converted immediately. ESLint forbids `throw` in `packages/core` except
in `assertNever` guards.
**Consequences.** Slightly more verbose call sites; radically fewer unhandled rejections. The React
layer gets one helper, `unwrapOr(value, fallback)`, so components stay clean.

### ADR-004 — On-device recommendation instead of an upstream "recommendations API"
**Context.** No server means no model hosting. Copying YT Music's model is impossible.
**Decision.** Hybrid: structural radio from `next()` (upstream algorithm, free, per-user session) +
local affinity graph + ε-greedy re-ranking (Architecture §4).
**Consequences.** Quality is "excellent but not identical" to YT Music. Fully explainable and offline —
a genuine advantage. Property-tested for diversity and no-repeat invariants.

### ADR-005 — Optional native extractor behind a port, never a hard dependency
**Context.** NewPipe Extractor is GPLv3; linking it into the app imposes obligations.
**Decision.** `ExtractorPort` has two implementations: `InnerTubeExtractor` (pure TS, default) and
`NativeExtractorBridge` (Kotlin plugin, **not bundled in the default build flavor**; enabled by a
build flag `-PwithNativeExtractor=true`). Licenses are documented per-flavor; the default APK ships
without GPL code.
**Consequences.** Two build flavors to test. Default build stays license-clean; power users can build
the enhanced flavor themselves. Documented in `03-OSS-HARVEST.md` §4.

### ADR-006 — Lyrics: LRCLIB + local index, no scraping of lyric sites
**Context.** Smart lyrical search is a headline feature; scraped lyric sites are hostile, blocked, and
legally murky.
**Decision.** Use **LRCLIB** (public, open, permissive, no key, CORS-friendly) as the lyric transport,
cache every fetched lyric locally, and build the inverted index **on device** from what the user
actually plays (plus optional bulk warm-up). Fuzzy matching uses MiniSearch BM25 with typo tolerance.
**Consequences.** Cold device lyric search is thin until the user has history — mitigated by a
first-run "warm-up" that indexes the user's YT Music library, and by the YouTube-text-search fallback
in the ladder (Architecture §3, step 4).

---

## 3. Rejected Alternatives (and why)

| Rejected | Reason |
|---|---|
| Next.js / Remix | Server runtime, route handlers, deployment story — direct conflict with C1/C2. |
| Electron | 120 MB installer, 300 MB RAM idle; Tauri does the same job at 8 MB. |
| React Native / Expo | Throws away the web preview requirement and the `packages/core` reuse; Media3 integration would still be custom either way. |
| Flutter | Same reuse problem, plus a second language for the engine. |
| Hand-rolled lyric crawler | ToS/robots violation, brittle, and legally indefensible. |
| Storing stream URLs persistently | They're signed and expire in ~6 h; persisting them guarantees broken playback. We persist *videoId + chosen format*, and re-resolve on play. |
| Service worker stream proxying on web | Double bandwidth, breaks Range semantics, and still hits CORS. |

---

## 4. Version & Compatibility Matrix (locked)

| Target | Minimum | Recommended | Notes |
|---|---|---|---|
| Android | 8.0 (API 26) | 13+ (API 33) | Media3 floor; `POST_NOTIFICATIONS` runtime permission on 33+. |
| WebView (Android) | Chrome 90 | Current | OPFS requires 86+; `createImageBitmap` 50+. |
| Desktop web | Chrome/Edge 100, Firefox 100, Safari 16 | Current | Firefox: no OPFS sync access → blob fallback path. |
| Windows | 10 1809 | 11 | Phase 4. |
| Device RAM | 2 GB | 4 GB+ | ffmpeg.wasm transcode requires 2 GB free — gated with a capability check. |
