# TheMashup — Native Android (Kotlin + Jetpack Compose)

> **Current status:** The last published APK passed GitHub Actions, but the
> current downloaded-playback, notification and performance changes are
> **not yet compiled or device-tested**. The user asked to collect more bugs
> before the next build, so do not push while the workflow would build it.
> Home, playback controls, FFmpeg execution and Google sign-in still need
> device verification. Older phase notes below are historical and may describe
> superseded designs.
> Android runs on the phone without a PC, gateway, or LAN; the web/desktop
> applications remain alongside it in the repository.
>
> **Current behavior (post-N9 review):** YouTube Music is the source of the
> recommendations rendered directly on the native Home screen. Sign-in uses a
> WebView only for the account flow; playback uses the native player. Tapping a
> song plays only that song, retains the previous track immediately after it,
> and does not enqueue a result list. Explicit queue buttons add individual
> songs without interrupting playback. The Home feed handles song, album and
> playlist recommendations; collections expand into individual songs on Home.
> The feed currently loads its first response page, not every continuation.
>
> Completed download rows now request playback or enqueue the selected local
> copy. New jobs persist their storage URI; legacy jobs attempt recovery by
> exact filename, folder and size. Missing or inaccessible copies show an error
> instead of silently streaming. These paths and the registered Media3 session
> are pending compilation and real-device validation. The queue is currently
> in memory; restoring it after a full process death or a system media-key
> resumption is not implemented.
>
> Download transfers use four concurrent byte ranges when the source supports
> them, validate ranges and HTTP validators, preserve segments for retries and
> app restarts, and fall back to a full download when ranges are unsupported.
> A changed source or a server that ignores ranges may require a restart; actual
> throughput depends on the source and connection. Downloaded videos appear in
> their own section only when at least one has completed.
> The session is stored with Android Keystore encryption in no-backup storage;
> the legacy settings file is excluded from backup during migration. The music
> endpoints and WebView sign-in depend on Google and can change or be blocked.

### Notification reference review

InnerTune, RiMusic and SimpMusic configure a Media3 notification provider and
connect a controller to their session; latentjam relies on Media3 foreground
handling and restricts external transport commands. PixelPlayerOSS also manages
service/session foreground lifecycle explicitly. TheMashup controls its player
in-process, so the current change explicitly registers the session with
`MediaSessionService` instead of depending on a UI controller to connect. The
same notification is used for lock-screen and Bluetooth transport. This is a
source-level comparison, not evidence that it works on a particular device.

### Pending device regression checklist

Once the user approves building, test with the actual APK on Android 8–9,
Android 10+, and a recent Android 13–15 device where available:

- Tap a pre-update downloaded song and a new download with network disabled;
  verify audio, progress, queue actions and playback after app backgrounding.
  Delete/move a copy and check that a useful error appears. On Android 10+,
  verify MediaStore recovery, and on Android 8–9 verify the app-folder fallback.
- Download an MP4, play it offline with video and audio, and confirm the separate
  video group appears only while completed MP4 downloads exist.
- Play a song and check the notification, title/art, pause/resume, next/previous,
  lock-screen and Bluetooth controls. Check after pausing, reopening the app and
  swiping it away; Android/OEM notification settings can change presentation.
- Verify search-result play retains the prior current song immediately behind it,
  and that queue actions add only the requested song without starting it.
- Exercise long Search/Library/queue lists and simultaneous downloads while
  measuring frame timing and CPU; no device profiling has yet established the
  cause or magnitude of the reported lag.

A focused on-device storage/playback/notification regression exists in
`OfflinePlaybackNotificationTest` and uses generated local audio, including
legacy-location recovery, background playback, notification controls, and cancelled-save cleanup. It has
not been compiled or run. After approval, run it on a connected device with:

```bash
cd android
./gradlew connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=local.themashup.music.OfflinePlaybackNotificationTest
```

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
4. **Downloads encoder = bundled FFmpeg**: N9 superseded the earlier first-run
   download requirement. CI builds ARM binaries and packages them in the APK;
   execution and codec behavior still require device verification.
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
| HTTP | OkHttp 4.12 + kotlinx-serialization 1.7.3 | LRCLIB, YouTube Music Home, Piped/Invidious fallbacks |
| Images | Coil 2.7.0 | Artwork loading + caching |
| Local data | kotlinx-serialization **JSON file repositories** (`JsonFileStore`: mutex + atomic tmp/rename + corrupt→`.bak` fallback) — same contract as the web's `data/*.json`; **KSP/Room deliberately avoided** (toolchain risk, no schema migrations needed at personal scale) | Likes, playlists (ordered), history, plays, download jobs |
| Themes persistence | DataStore Preferences | Survives restart (same contract as the web `localStorage` persist) |
| Color extraction | Palette (`androidx.palette`) | Dynamic album-art accent colors (port of `lib/colors.ts`) |
| Transcoder | FFmpeg built for ARM and bundled by CI | N9 user decision; device execution and codecs need validation |
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
| Recommendations | Authenticated YouTube Music Home feed rendered in the native Home screen | N9 review |
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
JSON `DownloadJob` row + Flow progress → ranged/resumable fetch where supported →
probe the bundled FFmpeg → run transcode via `ProcessBuilder` → write finished file
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

### N8 notes (delivered — final phase)

- **Visualizer** (`ui/logic/VisualizerBars.kt` + `ui/components/
  PlayerVisualizer.kt` + `core/player/OutputVisualizer.kt`): bar math is a
  web `Visualizer.tsx` port (44 bars, 3 px gap, `floor(i/bars·len)` bin
  spread, idle sine `0.12 + 0.08·sin(phase + i·0.45)`, `0.4 + v·0.6` alpha,
  top-rounded bars, art-1→art-2 gradient, reduce-motion floor 0.18) —
  sandbox-tested. Data source = `android.media.audiofx.Visualizer` on the
  ExoPlayer audio session (session id resolved reflectively — media3 `Int`
  or `AudioSessionId` both handled; R8 keep rule added), polled until the
  session exists, FFT capture rate = half of `getMaxCaptureRate()`.
  Permission: `RECORD_AUDIO` requested once from the expanded player —
  denial keeps the web's no-analyser idle sine, never an error. Mounted as
  the expanded strip (`h-16 max-w-lg opacity-90`, after PlayerControls) with
  the web header toggle (Activity→`GraphicEq`, "Visualizer on/off",
  white/50 when off) before Download + Like; toggle persists via
  `SettingsRepository.visualizerOn` (default on, web parity).
- **Error toast** (web `ErrorToast`): top-center red pill while
  `PlayerSnapshot.status == ERROR`, enter y −18/scale .96, auto-hide after
  6 s (web resets the store to paused; native play-from-ERROR reloads the
  track — same user outcome).
- **Motion**: `ui/components/Motion.kt` — `pressClickable` ≈ framer
  `whileTap` (TrackCard play ×0.9, theme swatches ×0.98) and `FadeSlideIn`
  ≈ mount entrances (hero y −8; shelf stagger `min(i·40, 320)` ms; search
  result rows y 8 with `min(i·30, 300)`; search empty state; library page
  y 14). Existing motion kept from N5-N6: Crossfade routes, expanded/queue
  slides, shimmer skeletons, DropdownMenu popover animation.
- **Recommendations (this phase's traceability row)**: audited — already
  delivered in N5 as the exact `recommendationsRouter` port (`Shelves.kt`:
  listen_again / quick / discover / trending, taste-vector + radio
  λ=0.5 fallback, titles, empty-shelf drop, authed order) with
  `ShelvesTest`; no further code required.
- **Release polish**: conditional release signing in
  `app/build.gradle.kts` (`android/app/key.properties` when present,
  git-ignored along with `*.jks`), `android/README.md` gained the full
  keystore → `assembleRelease` → install runbook, R8 keeps extended for the
  visualizer reflection, README phase table completed.
- **Deviations (deliberate)**: hover-only effects (web `group-hover`
  artwork/glow reveals, ThemeSwitcher `whileHover`) are omitted — touch has
  no hover; press feedback covers them. Shelf stagger runs per shelf, not
  per card (LazyRow recycling would re-animate rows on every scroll-back).
  The web downloads store's `banner` field is never rendered anywhere on
  the web either — not ported. The visualizer permission prompt happens at
  most once per process (web never prompts; Android requires it).
  `ConnectionScreen`/`ConnectionLostChip` are gateway concepts — N/A under
  hard requirement #1.
- **Risks**: some ROMs refuse `Visualizer` capture outright → idle sine
  (documented degrade); `getAudioSessionId` shape handled reflectively but
  is compile-unverifiable here; Compose layer + release R8 build remain
  fix-forward on your machine, as with N3-N7.
- **Gates**: sandbox **182/182** (+`VisualizerBarsTest` ×7), syntax green
  (**108 kt** / 5 xml / 1 toml), web matrix 124/124, `pnpm typecheck` 0.

### Feature parity matrix (N8 done-when)

| Requirement (this doc) | Native artifact | Phase | Status |
|---|---|---|---|
| Android-only runtime (no PC/gateway/LAN, ever) | Everything on-device; gateway concepts never ported | N1-N7 | ✅ |
| Aggregated streaming + failover | `ExtractionService` (NewPipe → Piped → Invidious) + `StreamFailover` (web-exact messages, 1 refresh) | N3/N4 | ✅ |
| Synced lyrics + karaoke | `LyricsPanel` (+0.05 line tolerance, center-scroll, glow) | N6 | ✅ |
| Hybrid smart search | `SearchScreen` (typeahead ⇄ pasted-lyrics fuzzy, `mergeHybrid`) | N6 | ✅ |
| Quality downloads + first-run ffmpeg | `FfmpegManager` / `DownloadEngine` / `MediaStoreWriter` / `QualityPicker` / `FfmpegSheet` | N7 | ✅ |
| Recommendations (shelves scoring) | `Shelves.kt` + `ShelvesTest` + Home shelves (audit this phase) | N5 | ✅ |
| Library: likes/playlists/reorder/history/follows | `LibraryScreen` + JSON repos (commit-on-drop reorder) | N2/N6 | ✅ |
| 5 persistent themes + dynamic art colors | `ThemeCatalog` + `Color.kt` + DataStore + `ArtAccents` | N5 | ✅ |
| Background / lock-screen playback | Media3 `MediaSessionService` + notification controls | N4 | ✅ |
| Animated UI | Crossfade routes, expanded/queue slides, `FadeSlideIn` entrances, `pressClickable`, shimmer skeletons, popover/menu animations | N5-N8 | ✅ |
| Visualizer | `OutputVisualizer` (session FFT) + `PlayerVisualizer` strip + header toggle + `visualizerOn` persistence | N8 | ✅ |
| Error toasts | `ErrorToast` port (6 s auto-hide pill) | N8 | ✅ |
| Skeletons / error cards | Shimmer shelves + search skeletons + amber charts-error retry (web verbatim) | N5 | ✅ |
| Status pill / header / theme switcher | `AppTopBar` + `ThemeSwatchPicker` | N5 | ✅ |
| Downloads progress UI + quality matrix | Downloads page + picker (N7 deviations noted there) | N7 | ✅ |
| Release APK docs | `android/README.md` signing runbook + conditional `key.properties` signing | N8 | ✅ |
| Media notification + panel controls (N9 fix) | `POST_NOTIFICATIONS` + latch-after-success + `setSessionActivity` | N9 | ✅ |
| Auto-next on dead tracks (N9 fix) | `PlaybackEngine.advanceOrPark` (manual=false, forward-only guard) | N9 | ✅ |
| On-device charts/suggestions (N9 fix) | `NewPipeSource.trending` via `trending_music`/`Trending` kiosks | N9 | ✅ |
| YouTube sign-in + Home recommendations | Verified account session → encrypted store → authenticated Music Home request | N9 review | Implemented; device test pending |
| Bundled ffmpeg (N9, directive reversed) | CI static build → `jniLibs/libffmpeg.so` + probe-only `FfmpegManager` | N9 | ✅ |
| Player redesign + shuffle emphasis (N9) | alpha-1 art, deck scrim, beat envelope (visualizer), accent pills | N9 | ✅ |
| APK via GitHub Actions (N9) | `.github/workflows/android.yml` → `TheMashup-debug-apk` artifact | N9 | ✅ |
| Gateway connection screen / SSE chip | N/A — no gateway exists by design (hard requirement #1) | — | N/A |

### N9 historical notes (superseded where the current-status section differs)

**CI APK factory (user: "build the apk using github actions. i don't wanna
go back and forth")** — `.github/workflows/android.yml` runs on every push to
this branch: static-ffmpeg matrix job → unit tests + `assembleDebug` →
artifact **`TheMashup-debug-apk`** (+ `test-reports`, ffmpeg logs, and
`::error::` API annotations on failure — log hosts are unreachable from the
authoring sandbox, so annotations are the diagnostic channel). First fully
green run: 40989959756.

- **Background playback had no notification** → `POST_NOTIFICATIONS`
  declared + runtime-requested (Android 13+); `ensureServiceStarted` only
  latches its flag **after** `startForegroundService` succeeds (a
  background-start rejection used to disable retries forever); the session
  gets `setSessionActivity(launchIntent)` so tapping the notification opens
  the app — play/pause from the panel works.
- **"Next song doesn't play / big error" (recurring FOSS bug)** →
  `PlaybackEngine.advanceOrPark(message)`: when a track is dead
  (candidates + refresh exhausted, or extraction failed) the queue
  **auto-advances** (`sm.next(snapshot, rng, manual=false)`; shuffle may
  jump to any unplayed index, linear only forward — wrap/repeat-ONE can't
  dead-loop). Parks in ERROR only when no forward move exists → the 6 s
  toast + tap-retry behaviour is preserved. Wired into `onPlayerError` and
  `resolveAndLoad` onFailure.
- **Suggestions error forever** → root cause wasn't auth: `NewPipeSource`
  never implemented `trending()` and the Piped/Invidious `/trending`
  endpoints are widely dead, so the charts walk always returned empty →
  "No recommendation data available". Fixed by driving NewPipe's kiosks:
  `trending_music` (YouTube Charts) first, classic `Trending` second;
  Piped/Invidious stay as fallbacks.
- **Sign-in and recommendations (revised)** → `SignInScreen` captures a
  Music session only in the login WebView, checks the account-menu response,
  and closes after saving it with Android Keystore encryption. The credential is
  sent only to the authenticated Music API, without following redirects. Home
  browses `FEmusic_home` and renders songs, albums and playlists natively;
  collection songs and search results enter the queue only on explicit action.
  The WebView is not used for listening. Live-account behavior remains untested.
- **FFmpeg bundled** (directive reversed to "just bundle the ffmpeg") →
  root cause of "downloads but fails to bundle": the BtbN pin was a
  **glibc** `linuxarm64` build that can never exec on Android (bionic).
  CI now builds a **static** FFmpeg per ABI with
  `Javernaut/ffmpeg-android-maker` (`-mp3lame -opus -x264`; their own CI's
  method; `--enable-shared/--disable-static` sed-patched so the executable
  links everything in), stages it as `jniLibs/<abi>/libffmpeg.so`
  (~11 MB artifact on armeabi-v7a), and `jniLibs.useLegacyPackaging = true`
  extracts it into `nativeLibraryDir`. Execution there is device-dependent
  and has not been verified on a physical device.
  `FfmpegManager` now just probes that binary; no network fetch, consent
  sheet only appears if the probe fails.
- **Player "wayy too transparent / make it react to the beats"** →
  artwork now renders at **alpha 1.0** (the theme's `artOpacity` of
  0.14–0.32 was the transparency), soft-blurred over a deck-solid scrim
  (0.34 → 0.96 → 1.0) and the lyrics/queue panel is opaque.
  Beat-reactive: `PlayerVisualizer` derives a spectral onset envelope
  (mean level vs its EMA — the idle sine never spikes, real hits do) each
  frame → bars pulse +32 %, the radial accent glow surges alpha + radius,
  and the background artwork breathes ±3.5 % scale per hit.
  **Shuffle** already existed (web parity) — shuffle/repeat now show an
  accent pill + border when active so state is unmistakable.
- **CI-only test repairs** (first-ever run of two unwired Gradle-only test
  files): `validate` returns `String?` since N7 (enqueue still throws the
  gateway message — both asserted now, arg order is container/quality);
  `instrumental` is non-null `Boolean` (`absent → false`); Invidious
  parsing includes N7 video-only candidates (2 audio + 1 video-only).

#### FOSS comparison (the five repos from the work order)

| Repo | What the README shows | Our status |
| --- | --- | --- |
| fast4x/RiMusic (ViMusic fork) | In-process extraction service, no prominent login, error-surfacing UI | Same extraction shape via NewPipe; login via N9 sign-in instead |
| Nikita-sud/latentjam | Kotlin-multiplatform, no Google login | N/A |
| maxrave-dev/SimpMusic | Multi YouTube-account + cookie ("send back to Google") | Cookie sign-in ✓ — multi-account + cookie refresh = future work |
| PixelPlayerHQ/PixelPlayerOSS | Self-hosted server logins (Navidrome/Jellyfin) | N/A (no servers by design) |
| z-huang/innertune | WebView cookie capture, account check, authenticated Music Home browse | Adapted in `SignInScreen` and `YouTubeMusicHome`; live behavior unverified |
| Recurring bug pattern (all) | Auto-advance when a track errors instead of parking | `advanceOrPark` ✓ — the "next song" trap |

## Build (your machine)

```bash
# one-time prerequisites: JDK 17+, Android SDK (ANDROID_HOME)
cd android
./gradlew assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk
./gradlew test                   # unit tests (domain + data)
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The build needs **JitPack + Google Maven + Maven Central** access (AGP,
Compose, Media3, NewPipe Extractor). GitHub Actions builds and packages the
FFmpeg binaries; the app does not download FFmpeg on first use.
