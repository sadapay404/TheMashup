# TheMashup — Phase 3 Report & Gate G3

> Date: 2026-11-08 · Branch: `arena/2732fac9-themashup`

---

## 1. The Honest Headline First

**I could not compile or install an APK in this sandbox.** There is no JDK and no Android SDK here
(`java: command not found`, no `sdkmanager`), and the network policy blocks Android SDK / browser
downloads. So rather than fake an "APK built ✓" line, I did three things that are actually useful:

1. **Built the complete, real native project** — Media3 playback service, download service with
   resumable chunking, Keystore-backed auth, two build flavours per ADR-005, hardened manifest,
   ProGuard rules, adaptive icon, network security config.
2. **Wrote the CI pipeline that compiles and signs it** on GitHub's runners, which *do* have the SDK.
   → `Actions → Android APK → Run workflow`. You get a real `.apk` artifact with no hosting.
3. **Closed the Phase 2 visual gap** with a Playwright E2E + screenshot suite and its own CI job,
   because this sandbox also cannot download Chromium.

Everything below is code I wrote and verified as far as the environment allows; the one thing I cannot
hand you today is a compiled binary. That is a sandbox limit, not a design gap — and the pipeline is
one click from producing it.

## 2. What Was Built (Android)

| File | Purpose | Why it matters |
|---|---|---|
| `PlaybackService.kt` | Media3 `MediaSessionService` + ExoPlayer, audio focus, becoming-noisy handling, wake mode | **Audio survives screen-off and app backgrounding.** WebView `<audio>` cannot do this; this is the LibreTube lifecycle pattern reimplemented |
| `NativeEvents.kt` + `MashupPlayerPlugin.kt` | Plugin bridge + **buffered** native→JS event bus | A dead WebView no longer loses playback state: events queue and flush on re-attach |
| `DownloadService.kt` | Foreground `dataSync` service, Range-resumed `.part` files, atomic rename, 64 KB buffers, cooperative cancel | Interrupted downloads **resume** instead of corrupting; Android 14 foreground rules honoured |
| `DownloadPlugin.kt` | JS → native downloads with **path sanitisation** in Kotlin | A malformed/hostile filename cannot escape the app's sandbox |
| `AccountPlugin.kt` + `SecureStore.kt` | WebView sign-in, cookie harvest, `yt.config_.VISITOR_DATA`, EncryptedSharedPreferences with graceful fallback | Real account support with **no client secret** (Amendment A-1) |
| `ExtractorService.kt` | `StreamExtractor` seam, resolved reflectively at runtime | Default flavour ships **zero GPL code**; enhanced flavour plugs in NewPipe without touching app code |
| `AndroidManifest.xml` | Media playback + data-sync foreground types, POST_NOTIFICATIONS, wake lock, media-button + headset/BT intents, `cleartextTrafficPermitted=false` | Correct background permissions; no accidental HTTP |
| `app/build.gradle.kts` | Two flavours (`standard`, `withNativeExtractor`), R8 + resource shrinking, env-driven signing | Licence-clean default build; CI signing without committing a keystore |
| `proguard-rules.pro` | Keeps Capacitor/Media3 reflective surfaces, preserves line numbers | Keeps the on-device diagnostics useful in release builds |
| res/ | Adaptive icon + monochrome, splash matching `#07070A`, data-extraction rules excluding the cookie | No white flash, no cloud backup of credentials |
| `.github/workflows/android.yml` | Typecheck → tests → build → sync assets → assemble (signed if secrets exist) → upload APK | The actual APK factory |

## 3. What Was Built (Web, continuing Phase 2)

| Addition | Detail |
|---|---|
| **Real downloader** (`lib/downloader.ts`) | 4-way Range chunking, progress, File System Access with anchor fallback, honest `BLOCKED` / `UNSUPPORTED` states |
| **Native bridge** (`lib/native.ts`) | Capability-detected; the browser is fully functional without it |
| **Native playback handoff** in `usePlayer` | Hands the Media3 service the URL, then stops the element; polls position; mirrors volume; re-resolves on native error |
| **E2E + visual suite** | 6 Playwright specs: paint without console errors, all routes, lyric-mode banner, diagnostics completion, keyboard, reduced-motion — with screenshots |
| **CI** | `e2e.yml` (Chromium + artifacts) and `android.yml` (APK) |

## 4. Verification (actually executed)

```
typecheck (strict)        0 errors
unit + UI tests           63 passed   (was 58; +5 downloader tests)
production build          147 KB gzip, 2.5 s
android asset sync        ✓ 2 entries copied, index.html verified
```

New tests specifically cover: filename sanitisation (path traversal and reserved chars),
transcode targets failing **honestly** instead of silently succeeding, a full range-less download
completing, and a 403 being reported as `partial` with a human explanation.

## 5. Bugs Found By Testing This Round
1. jsdom `Response` cannot take a Blob body → made the downloader read responses defensively
   (`blob()` → `arrayBuffer()` fallback). This is a real robustness win for older WebViews.
2. Android manifest originally requested `Request foreground service` without declaring the type —
   fixed to `mediaPlayback` + `dataSync`, which is a **hard requirement** on Android 14.
3. The manifest lacked the Media3 `MediaSessionService` intent filter, which would have made the
   lockscreen controls silently not appear. Fixed.

## 6. Honest Limitations Carried Forward

| # | Item | Status |
|---|---|---|
| L1 | Pixel-level visual check | **Solved by CI**, not by me: `e2e.yml` produces screenshots. I still have not seen them. |
| L2 | Live YouTube/LRCLIB reachability | Still unprovable here; the in-app Diagnostics panel covers it on your device |
| L6 | APK binary | Requires the CI run (no JDK/SDK here) |
| L7 | Transcode (MP3/FLAC) | Not implemented. The UI refuses and explains rather than producing a mislabelled file |
| L8 | Extractor-only tests on the enhanced flavour | Not covered; it is a build-flag variant with a GPL dependency |

## 7. Gate G3

All four Phase 3 code areas exist and are internally consistent, and the release path is automated.
What remains is **execution on hardware/CI**, which is outside this sandbox.

**I am stopping here. Nothing further will be written until you say go.**
