# TheMashup — Native Android (Kotlin + Jetpack Compose)

> **Status:** Phase 1 — blueprint + skeleton. This is a **full rewrite** of the
> app as a true native Android application: **no PC, no gateway, no LAN —
> ever.** Everything (YouTube extraction, streaming, lyrics, downloads,
> library, recommendations) runs on the phone. The existing web/desktop code
> (`apps/`, `packages/`, `services/`, `desktop/`, `mobile/`) stays untouched
> beside it; this app lives in `android/`.

## Hard requirements (user-locked)

1. **Android-only runtime** — the app must be fully usable with no computer
   anywhere: install → works (internet for streams/lyrics only).
2. **UI kept as close as possible** to the current React app — same layout
   language, same five themes, same screens, same component feel. This is a
   port of the design, not a redesign.
3. **Every original feature satisfied** — aggregated streaming with failover,
   synced lyrics + hybrid search, quality downloads, recommendations,
   library (likes/playlists/history), persistent themes, background/lock-screen
   playback, polished animations.
4. **Downloads encoder = first-run download**: the APK stays slim; on first
   download the app fetches a pinned static ffmpeg build once (~122 MB,
   from GitHub `BtbN/FFmpeg-Builds`,
   `ffmpeg-n8.1-latest-linuxarm64-gpl-8.1.tar.xz` — the planned n9.0 arm64
   asset was not on the live release feed at N7 build time; swap the single
   `FfmpegManager.FFMPEG_URL` constant if it reappears)
   into app storage and caches it. No transcoder code bundled in the APK.
5. **PC/server code untouched** — Tauri desktop + Express gateway + Python
   resolver remain as they are.
6. **Phased delivery with hard gates** — report after each phase, stop, wait
   for explicit written permission.

## Stack (pinned, verified against live release feeds)

| Concern | Choice | Why |
| --- | --- | --- |
| Language/UI | Kotlin 2.4.21, Jetpack Compose (Compose BOM 2024.10.01), Material 3 | Native, declarative, closest idiomatic match for porting the React design |
| Build | Gradle 8.9 wrapper, Android Gradle Plugin 8.7.3, JVM target 17 | Conservative known-good pairing (authoring sandbox has no JDK — build runs on your machine) |
| SDKs | minSdk 26 (Android 8), compileSdk/targetSdk 35 | Covers Media3 + notification channels; edge-to-edge handled by Compose `WindowInsets` |
| Playback | Media3 ExoPlayer + `MediaSessionService` | Real lock-screen/notification controls, background play, audio focus, seekbar — native, not a WebView trick |
| YouTube | **NewPipe Extractor v0.26.5** (JitPack) | Battle-tested keyless extraction: search, stream candidates, related/radio, exact audio formats; direct stream URLs handed to ExoPlayer with proper headers |
| HTTP | OkHttp 4.12 + kotlinx-serialization 1.7.3 | LRCLIB lyrics, Piped/Invidious fallbacks, ffmpeg fetch |
| Images | Coil 2.7.0 | Artwork loading + caching |
| Local data | kotlinx-serialization **JSON file repositories** (`JsonFileStore`: mutex + atomic tmp/rename + corrupt→`.bak` fallback) — same contract as the web's `data/*.json`; **KSP/Room deliberately avoided** (toolchain risk, no schema migrations needed at personal scale) | Likes, playlists (ordered), history, plays, download jobs |
| Themes persistence | DataStore Preferences | Survives restart (same contract as the web `localStorage` persist) |
| Color extraction | Palette (`androidx.palette`) | Dynamic album-art accent colors (port of `lib/colors.ts`) |
| Transcoder | Static ffmpeg binary, first-run download → `filesDir` | User decision: slim APK, one-time ~128 MB fetch, exact MP3/FLAC/Opus output |
| Syntax gate | `tree-sitter-kotlin` (`scripts/check_android_syntax.py`) | Authoring sandbox cannot compile Android/Kotlin — every phase must pass this parse + XML/TOML validation before commit |

### Known authoring constraints (honesty contract)

- The sandbox has **no JDK/Android SDK/Maven access**, so Gradle builds, unit
  tests, and instrumented behavior are compiled/run **on your machine** via
  `cd android && ./gradlew build`. Each phase ships a `BUILD.md` step list;
  if the build breaks, send the error back and it is fixed under the same
  phase before the gate passes.
- Pure-Kotlin domain logic (N2+) is additionally executed in-sandbox with a
  standalone Kotlin 2.4.21 compiler + JDK 21 fetched from the **npm registry
  and PyPI** (`kotlin-compiler` tarball, `jdk4py` wheel — GitHub release
  assets redirect off the sandbox's allowlist) via
  `scripts/test-kotlin-domain.sh`; the same test classes also run under real
  JUnit on your machine with `./gradlew test`. Data-layer tests (JSON store)
  need the serialization runtime and run only via Gradle.
- Dependency pins were chosen from verified release feeds (GitHub API for
  Kotlin/KSP/NewPipe/ffmpeg assets); Google-Maven artifacts (AGP, Compose,
  Media3) are pinned to well-known stable versions above.

## Feature traceability (original spec → native implementation → phase)

| Original requirement | Native approach | Phase |
| --- | --- | --- |
| Blueprint/monorepo (Phases 1–2 web) | This document + Gradle/Compose skeleton | **N1** |
| Supabase-everything + local fallback (web Ph4) | On-device store only; local profile identity (no Supabase creds exist — same reason the web shipped demo mode first) | N2 |
| Shared domain logic (ranking, lyrics fuzzy match, quality matrix, queue math) | Ported from `packages/shared/src/*.ts` to pure Kotlin with tests | N2 |
| YT-primary streaming + fallbacks (web Ph2/5) | NewPipe Extractor direct streams (primary); Piped/Invidious HTTP (fallback) | N3 |
| Engine failover (web Ph3 `audioEngine`) | ExoPlayer + candidate list; `Player.Listener` on error → advance candidate preserving position | N4 |
| Lock-screen/notification controls (web Ph6 + Capacitor Ph8) | `MediaSessionService` + Media3 notification (now truly native) | N4 |
| Lyrics + karaoke highlighting (web Ph3) | LRCLIB client (same endpoints: `/api/search`, `/api/get` ±2 s duration match), Compose karaoke UI | N6 |
| Hybrid smart search (web Ph4) | Same behavior: free text ⇄ pasted-lyrics fuzzy match (ported scorer) | N6 |
| Auth + library (web Ph4) | Local profile: likes, playlists with drag-reorder, history, follows | N2/N6 |
| Downloads + quality picker (web Ph5) | MediaStore scoped-storage writer, first-run ffmpeg, SSE-equivalent progress via Flow | N7 |
| Recommendations (web Ph5) | Ported scoring: quick/trending/discover/listen-again shelves | N8 |
| 5 persistent themes + dynamic art colors (web Ph3/6) | Theme system in Compose, tokens ported from `apps/web/src/styles/index.css`, DataStore persistence | N5 |
| Animations/visualizer (web Ph6) | Compose motion + `android.media.audiofx.Visualizer`-driven canvas | N8 |
| Desktop shell (web Ph7) | *(PC code untouched — not applicable to native app)* | — |
| Capacitor shell (web Ph8) | Superseded by this app; `mobile/` left untouched | — |

## App architecture

```
local.themashup.music
├── TheMashupApp.kt            Application root — manual DI container (AppContainer)
├── MainActivity.kt            single activity → setContent { TheMashupTheme { App() } }
├── core/
│   ├── domain/                pure Kotlin: models, recommend/fuzzy/queue/quality logic
│   ├── data/                  JsonFileStore + repositories, DataStore settings
│   ├── network/               extraction facade (N3): NewPipe source, Piped/Invidious
│   │                          pools, LRCLIB client — logic/ pure (sandbox-tested),
│   │                          parsing/ wire codecs, ExtractionService walk
│   ├── download/              job runner: fetch → ffmpeg (Process) → MediaStore
│   └── player/                ExoPlayer + MediaSessionService + queue controller
└── ui/
    ├── theme/                 5 themes (frosted, paper-ink, neon, aurora, vinyl)
    ├── navigation/            NavHost: Home · Search · Library · Downloads (+ player)
    ├── components/            ports of Sidebar, cards, rows, drawers, sheets
    └── screens/               per-screen Compose UI
```

**Data flow (playback):** Search screen → `ExtractorRepository.search()` →
domain `Track` list → user taps → `StreamResolver.resolve(track)` returns
ordered `StreamCandidate`s (audio-only formats, best-first, like the web
quality ordering) → `PlayerController.play(candidates)` → ExoPlayer with
`DefaultHttpDataSource` (UA + referer headers) → on
`onPlayerError` → shift to next candidate, restore position
(MIRrors `MAX_FAILOVER_ATTEMPTS = 6`) → MediaSessionState flows to
lock-screen/notification and the Compose UI.

**Data flow (download):** quality sheet → `DownloadRepository.enqueue()` →
JSON `DownloadJob` row + Flow progress → network fetch of chosen stream URL → if a
transcode is needed, first ensure ffmpeg (show the one-time download sheet
with progress) → run transcode via `ProcessBuilder` → write finished file
into `MediaStore.Downloads` (scoped storage, no permissions on 10+) →
notification/UI update.

## UI mapping (web → Compose, kept as close as possible)

| Web artifact | Native target |
| --- | --- |
| Sidebar nav (Home/Search/Library/Downloads) + status pill | Compose `NavigationRail` on wide, modal drawer on phone (mirrors current responsive behavior) |
| Header + theme switcher | Top app bar with the same 5-swatch switcher |
| Home shelves (quick/trending/listen-again/discover) | LazyColumn sections, same card style |
| Search page (typeahead + hybrid lyrics paste) | Same two-mode behavior + fuzzy result rows |
| Library tabs (likes/playlists/history/follows) | Same tabs; drag-reorder in playlists via long-press |
| Downloads page (quality sheet, progress rows, save) | Same sheet + rows; native save path |
| Expanded player + lyrics karaoke + queue drawer | Fullscreen player, synced-lyrics pager, queue sheet |
| Error toasts/skeletons/visualizer | Same behaviors (N8) |
| Themes + `--art-1/--art-2` accents | `ThemeId` enum → Material3 color schemes; Palette-based accent flow |

## 8-phase plan (hard gates — report, stop, wait for written permission)

| # | Phase | Done when |
|---|---|---|
| **N1** | Blueprint + buildable Compose skeleton (this doc, `android/` project, theme shell, syntax gate script, README) | Syntax gate green; `./gradlew assembleDebug` documented; report |
| **N2** | Pure-Kotlin domain core + local data layer (models, ported algorithms + tests, JSON-file repositories, settings persistence via DataStore) | `./gradlew test` green on build machine; in-sandbox execution of pure logic (48 domain tests via `scripts/test-kotlin-domain.sh`) |
| **N3** | Extraction + lyrics networking (NewPipe search/streams/related, LRCLIB, Piped/Invidious fallback, fixture tests) | Live smoke on device/emulator: search → candidates resolve |
| **N4** | Player (Media3 ExoPlayer + MediaSessionService, queue/repeat/shuffle, failover, audio focus, notification/lock screen) | Background play + controls verified on device |
| **N5** | Shell + themes + Home/Search UI (5 themes ported from CSS, persistence, navigation, cards/shelves, dynamic art accents) | Screens visually match web counterparts |
| **N6** | Library + lyrics/karaoke + expanded player UI (likes/playlists reorder/history, synced highlighting, hybrid search UX) | Full listening loop without leaving the app |
| **N7** | Downloads (first-run ffmpeg sheet + transcode + scoped storage + progress/cancel + quality matrix) | File lands in system Downloads, correct format/bitrate |
| **N8** | Recommendations + motion/visualizer + release polish (shelves scoring, animations, signing docs, README final) | Matrix of feature parity vs this doc; release APK docs |

### N5 notes (delivered)

- **Shell**: `ui/App.kt` — edge-to-edge `Scaffold`, custom top bar (brand chip +
  page title/blurb per web `PAGE_TITLES` + **5-swatch theme switcher** + local
  profile chip), `Crossfade` page swaps, back-to-home, 4-tab `NavigationBar`,
  floating `MiniPlayer` (progress line + transport) above the nav; expanded
  player/queue/lyrics actions are N6. `MainActivity` now just mounts
  `TheMashupRoot(container)`.
- **Themes**: exact `[data-theme=…]` CSS tokens → `ui/theme/Color.kt`
  (`MashupTokens` + M3 schemes incl. translucent surfaces/borders); `ThemeId`
  moved to pure `ui/logic/ThemeCatalog.kt` (labels/hints/swatch triples verbatim
  from `ThemeSwitcher.tsx`) with sandbox tests; persistence via
  `SettingsRepository.setThemeKey` (DataStore) — default **frosted**
  (`DEFAULT_THEME` fixed from `paper` to match web). Paper & Ink + Vinyl render
  the serif display family.
- **Home**: hero card (welcome copy — "gateway" line adapted to "resolved
  on-device with automatic source failover") + shelves from
  `Shelves.kt` (port of api `radio.ts` recommendations: listen_again from the
  local library, quick/discover/trending over the charts pool). **Charts pool is
  new**: `ExtractionLogic.trending` walk → Piped `GET /trending` +
  Invidious `GET /api/v1/trending?region=US` (`Wire` array decoders, category
  `video`), exposed as `ExtractionService.trending`. Cards = web TrackCard
  (art + `--art-1` glow + Radio/queue/play overlay + "playing" pill), shimmer
  skeletons, amber charts-error card with retry.
- **Search**: `SearchScreen` merges the web typeahead + full-page behaviors for
  mobile — 170 ms debounce, parallel `search` + `lyricMatch` + `suggest`
  (`ExtractionService.suggest` = new Piped suggestions walk), error only when
  both catalog and lyric sources fail, filter chips with counts, artist chips
  derived from track artists, `mergeHybrid` rows, LyricMatch rows resolve
  `"{track} {artist}"` → play top hit (web exact), suggestion chips, shimmer +
  empty/error states.
- **Art accents**: `ui/art/ArtAccents.kt` — Palette sampling with the web
  `colors.ts` saturation/luminance filter, `fallbackArtColors` hash fallback;
  `LocalArtAccents` feeds card glows app-wide.
- **Gates**: sandbox **141/141** (`ShelvesTest`, `ThemeCatalogTest`,
  `ArtFallbackTest`, `ExtractionWalkTest` added), syntax 83 kt green, web matrix
  124/124, tsc 0. Known risks: Compose layer compiles only on the build machine
  (Gradle) — sandbox covers `ui/logic` + domain + network logic; Material3/
  Coil/Palette APIs pinned via BOM versions in `libs.versions.toml`.

### N6 notes (delivered)

- **Library** (`ui/screens/LibraryScreen.kt`): web `LibraryPage` — Liked /
  Playlists / Recently played tabs with counts, empty states, inline creation
  (120-char cap; creating opens the new playlist), playlist detail (cover =
  first-track artwork — the local `Playlist` has no `cover_url`, Play all,
  Delete) and **long-press drag reorder** committing one move per gesture
  (framer `Reorder.Group` port; see deviations), remove-from-playlist rows;
  history rows carry `relativeTime` stamps + add-to-playlist. SignInGate is
  omitted — the local profile is always identified.
- **Follows**: web `ArtistChip` in Search — tap toggles follow (accent +
  check, artwork avatar); keyed by artist **name** in the local repo (web uses
  `channel_id ?? name`).
- **Expanded player** (`ui/player/ExpandedPlayer.kt`): blurred artwork
  background (API 31+ `Modifier.blur`; scrim-only below) at the per-theme
  `--art-opacity` (new `MashupTokens.artOpacity` — .32/.14/.30/.34/.26),
  radial art-1 overlay at 30%/20%, Collapse pill, **`contextLabel`** (new
  additive `PlayerSnapshot` field threaded `sm.playQueue → engine.playQueue`:
  `endless radio` / raw label / `now playing`), failover sparkle note
  (`activeIndex + refreshesUsed`, current-track scope vs web session count),
  LikeButton, decorative vinyl disc shown ≥600dp (web `sm:` breakpoint) that
  spins only while playing, title/artist, SeekBar (preview-scrub semantics),
  large PlayerControls (spinner while LOADING), Lyrics/Queue tab panel.
  Visualizer → N8; Download button → N7.
- **Lyrics/karaoke** (`ui/lyrics/LyricsPanel.kt`): LRCLIB fetch per track on
  IO, active line via pure `activeLineIndex` (+0.05, web-exact), center
  auto-scroll only on line change (`scrollOffset = viewport/2 − 26dp`
  approximation of `scrollIntoView({block:"center"})`), tap-to-seek, web
  alpha/scale/glow (art-1 text shadow 55%), loading/empty/plain/instrumental
  states verbatim; `relativeTime` port in `ui/logic/LyricClock.kt`.
- **Queue**: `QueueList` shared by the expanded tab + the right slide-in
  drawer (scrim, header count, clear, close); tap = `playQueue(startIndex,
  context="queue")` + history record; remove buttons stay visible on touch
  (web hides them behind desktop hover). MiniPlayer gained the web mobile
  cluster: queue button (accent while open) + expand chevron, meta tap
  expands.
- **Controls**: `PlayerControls` (shuffle·prev·play·next·repeat + active
  underline dots) and `SeekBar` (side times, accent track, drag preview +
  commit) are faithful ports; `AddToPlaylistButton` popover → anchored
  `DropdownMenu` with web copy incl. “Create playlist & add” → `My Playlist`.
- **Gates**: sandbox **151/151** (+`LyricClockTest`, contextLabel test,
  ExtractionWalk naming fix), syntax green, web matrix 124/124, tsc 0.
  Deviations/risks: drag-reorder commits on release (no live row shuffling
  like framer); history timestamp sits inline (web absolute overlay); queue
  remove always visible; failover note counts the current track only;
  `Modifier.blur` no-ops below API 31; Compose layer still Gradle-compile-only
  (sandbox covers `ui/logic` + player + domain logic).

### N7 notes (delivered)

- **Pipeline** (`core/download/`): `logic/DownloadLogic.kt` (pure) owns the
  quality→height matrix, audio/video candidate selection (muxed-first, strict
  ≤target cap, adaptive split + best audio pair), resolver-exact ffmpeg argv
  (`libmp3lame` 128k/320k · `flac` · `libopus` 160k · mp4 copy→x264+aac
  fallback, split `-map 0:v:0 -map 1:a:0`), filename sanitize/dedupe, MIME
  map, progress percent (0..98, 99 = processing) and ETA math;
  `logic/TarArchive.kt` streams the single `bin/ffmpeg` member to disk.
  `FfmpegManager` pins the BtbN asset → `filesDir/ffmpeg/bin/ffmpeg`
  (xz via `org.tukaani:xz:1.9`, chmod + `ffmpeg -version` probe, StateFlow
  Missing/Downloading/Extracting/Ready/Failed). `MediaStoreWriter` inserts
  into `MediaStore.Downloads` (`RELATIVE_PATH Download/TheMashup`,
  IS_PENDING handshake, display-name dedupe) on Q+; below Q it tries the
  public dir then falls back to app-external Downloads with a job warning
  (no runtime storage prompt). `DownloadEngine`: 2-worker semaphore, OkHttp
  fetch (candidate headers, EMA speed + ETA via repo Flow), PROCESSING at 99,
  300 s transcode timeout with primary+fallback argv, OkHttp Call tracked for
  instant cancel (row removal = web `cancel`), in-place Retry, start-time
  reconcile (`interrupted by restart`), and a consent cycle so the first-run
  sheet parks jobs until Accept/Decline.
- **Extraction video**: NewPipe `videoStreams` (muxed) + `videoOnlyStreams`
  (fields contract-verified against v0.26.5 source), Piped `videoStreams`
  DTO, Invidious video adaptive entries → `StreamCandidate` gains additive
  `videoOnly`. Playback filters `videoOnly` candidates (they are silent) —
  `ExtractionService.streams()` unchanged, so `/formats`-equivalent data for
  the QualityPicker comes from the same call.
- **UI**: `DownloadsScreen` (subtitle swap, ffmpeg pill = ready/transcoding
  limited + tap-to-open setup, always-live pill, In progress / Finished
  sections, verbatim empty state → Find something = search page),
  `QualityPicker` dialog (artwork header, “Loading available formats…”, 2×2
  chips verbatim, “not available” beyond manifest max height + “· up to Nh”
  / “· no video formats”, ≈size from candidate bytes, error line, footnote),
  `FfmpegSheet` (consent + byte progress/Unpacking/Try again), download icons
  on search/library rows + expanded-player header.
- **Deviations (deliberate)**: finished rows have no Save/Open button — the
  engine already wrote the file into system Downloads at completion (the web
  button exists because the gateway hosts the file); 4K chip targets 2160
  (web `parseInt("4k")`→0 never disables it — treated as a web bug); ffmpeg
  pin is n8.1 (live feed had no n9.0 arm64 asset); API 26-28 files land in
  app-external Downloads with a warning instead of a storage-permission
  prompt; the “live” SSE pill is always on (jobs stream in-process); the
  sign-in gate is skipped (local profile always identified).
- **Risks**: the BtbN `linuxarm64` build is a static glibc binary — expected
  to exec on Android (static, no glibc loader), and the `-version` probe
  reports Failed honestly if a device refuses it (fix-forward: swap
  `FFMPEG_URL` to an Android-built static asset, one constant);
  kotlinx-serialization fixtures were not extended for video payloads
  (parse paths syntax-gated + `StreamNormalizeVideoTest` covers mapping);
  Gradle compile + on-device transcode pending your build — same fix-forward
  posture as N3-N6.
- **Gates**: sandbox **175/175** (+`DownloadLogicTest`, `TarArchiveTest`,
  `StreamNormalizeVideoTest`, dedupe case), syntax green (103 kt / 5 xml /
  1 toml), web matrix 124/124, `pnpm typecheck` 0.

## Build (your machine)

```bash
# one-time prerequisites: JDK 17+, Android SDK (ANDROID_HOME)
cd android
./gradlew assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk
./gradlew test                   # unit tests (domain + data)
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

First run needs **JitPack + Google Maven + Maven Central** access (AGP,
Compose, Media3, NewPipe Extractor). The ffmpeg engine download happens on
first use of Downloads (GitHub releases).
