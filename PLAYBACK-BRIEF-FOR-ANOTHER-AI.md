# Brief: make TheMashup play whole songs

You are taking over a music player that **has never once played a full song on a real phone**. The previous engineer made five attempts, each explained by a confident theory that the next report disproved. Treat every claim in this document as suspect *except* the code and the logs, which you must read yourself.

Your job is not to propose a fix. It is to **make a full song play end to end on the user's device and prove it**.

---

## 1. The repo

```
https://github.com/sadapay404/TheMashup
```

- Android app: `apps/android` — Capacitor WebView wrapping a Media3/ExoPlayer playback service.
- Web app: `apps/web` — React 19, TypeScript, framer-motion. All UI and all resolution logic.
- Core: `packages/core` — InnerTube client, parse, Piped/Invidious, recommend, lyrics.
- Package id: `app.themashup.music`
- Current HEAD: `e77d856` (branch `arena/2732fac9-themashup`)

### Hard rules of the environment

- **You cannot build locally.** There is no JDK, no Android SDK, no adb, no USB. Every APK must be built by GitHub Actions. Do not waste time trying.
- Build by pushing a tag: `git tag v0.3.0-apk.NN && git push origin v0.3.0-apk.NN`.
  The workflow `.github/workflows/android.yml` triggers on `v*` tags, derives `versionCode`/`versionName`
  from `apk.NN` in the tag, builds, and attaches `app-standard-release.apk` to a GitHub Release.
  `versionName` becomes `0.3.0-apk.NN`. Use the **next free number** (current release is `v0.3.0-apk.34`).
- `gh run view --log` and `gh run download` **fail in this sandbox** with EOF. To read a failure use:
  `gh api repos/sadapay404/TheMashup/check-runs/<job_id>/annotations --jq '.[].message'`
  Job id: `gh api repos/sadapay404/TheMashup/actions/runs/<run_id>/jobs --jq '.jobs[0].id'`
- Release APK download from here also fails (asset CDN is TLS-blocked). The user downloads it manually.
- You **cannot test network calls to YouTube** from this sandbox — it is TLS-blocked. So you cannot verify a
  stream URL resolves. Compensate by making the app report what happened on the device.
- Run `npx tsc -p apps/web/tsconfig.json --noEmit`, `cd apps/web && npx vitest run` (226 tests), and
  `npm run build` before every tag. All must be clean.
- `cap sync` overwrites `capacitor.build.gradle` / `capacitor.settings.gradle` — `git checkout` them after.
- Do not commit generated `dist/`, and keep the working tree clean before tagging.

---

## 2. The symptom, precisely

Verified from the user's own logcat capture (`build: 0.3.0-apk.31 (31)`):

```
stop(4093): called with 1438080 frames delivered
```

1438080 ÷ 48000 = **29.96 s** of audio actually rendered, then silence. ExoPlayer `Release` follows
immediately; `onPlayerError` does **not** appear in the log.

The user's reports, in order: "songs still don't play" → "still don't play" → "still don't play". The most
recent test was on `0.3.0-apk.34`. **No report has yet included the app's own diagnostics file**, which is the
single biggest hole in the investigation. Fixing that is your first task.

---

## 3. What has already been tried, and why each explanation failed

Read this so you do not repeat it. Each was disproved by evidence, not by opinion.

| Attempt | Theory | Why it was wrong |
|---|---|---|
| 1 | Stream never resolves (CORS) | Audio rendered; something resolved |
| 2 | ExoPlayer methods on wrong thread (crash) | That fixed a *different* bug (launch crash) |
| 3 | It's a 30-second preview clip | `approxDurationMs` was never even parsed; the number is too round for a clip |
| 4 | Preview guard + `ANDROID_VR`/`TVHTML5_SIMPLY` clients first | Still fails. Either those clients are rejected for this IP/region, or the cause is elsewhere entirely |
| 5 | Prefer cheapest stream | Still fails |

**Do not assume #4 is right and just needs a tweak.** It is one hypothesis among many and it has now failed a
real-world test.

### A live contradiction you must resolve

`usePlayer.ts` has an `onNativeEvent('error')` handler that, on any non-`player_not_ready` error, shows
"Native player error — re-resolving…" and calls `load(t)` from zero. **The 29.96s log shows no error event at
all.** Either:

- (a) the 403 arrives as a *silent* end-of-stream (`STATE_ENDED`, no error), or
- (b) the error event is emitted but the JS listener never receives it, or
- (c) the audio is coming from the WebView `<audio>` element, not ExoPlayer, despite the native plugin.

Determine which. It changes everything.

### Candidate causes — investigate all, rank by evidence

1. **Token-gated 1 MB cut.** Media server serves ~1 MB then 403. At 256 kbps ≈ 31 s. The "cheapest stream"
   change should have moved the cut to ~50 s, not removed it. If you still see ~30 s *and* the chosen itag is
   low-bitrate, this theory is dead too.
2. **Silent 403 → `STATE_ENDED`.** ExoPlayer may report end-of-stream rather than an error on a truncated
   progressive MP4 with no `Content-Length`. Then the app thinks the song finished and auto-advances.
3. **ExoPlayer data-source limits.** No `LoadControl`/`DefaultHttpDataSource` tuning; Media3 version is 1.3.1.
4. **The `<audio>` element is the actual player.** `hasNativePlayback()` may be false, or `nativePlay` returns
   false, and the WebView element is playing the same gated URL.
5. **SABR.** `ANDROID_VR` ≥ 1.65 may return SABR-only responses, which are not plain URLs at all. We pin
   1.65.10, but confirm the response actually contains `adaptiveFormats` with `url`.
6. **Not playback at all.** Consider that the user may be describing silence from the *speaker* while audio
   renders (volume/focus/stream routing), or a track that is not the one tapped.

---

## 4. Your obligations, in order

### 4.1 Make the app tell the truth (do this first, ship it, then continue)

The app has a diagnostics log the user can export from Settings. It is written by
`LogPlugin.boot()` in `apps/android/.../diagnostics/LogPlugin.kt` and reached from the web side through
`nativeBootMark()` in `apps/web/src/lib/native.ts`.

Required, as a minimum:

- Log **HTTP status and byte count** of the media request itself. Attach an
  `HttpDataSource.Factory` with a `ResolvingDataSource` or a logging `DataSource` in
  `PlaybackService.kt` (`DefaultMediaSourceFactory(DefaultDataSource.Factory(this))` is currently unlogged).
  Record: request URL host (strip query params — they are tokens), response code, `bytesRead`, and the
  exception on failure.
- Log every `onPlayerError` with `error.errorCodeName` and `error.cause` message. Currently only the code name
  is emitted to JS and nothing is written to the file.
- Log `STATE_ENDED` together with `durationMs` and `currentPosition` so a 30 s "end" of a 200 s track is
  unmistakable.
- Log which path is actually playing: native service or `<audio>` element, plus `hasNativePlayback()`'s value.
- Log the resolved profile, itag, bitrate, and declared duration (partly done — verify it appears).

Do not accept "it should log". Verify the lines exist by writing a unit test where possible, and keep the
format greppable and one-per-line.

### 4.2 Benchmark against clients that work

Read how these solve it, and follow them rather than inventing:

- **yt-dlp** `INNERTUBE_CLIENTS` and its PO Token wiki — the authoritative client table.
- **NewPipe Extractor** / **InnerTune** — which clients and which stream selection.
- **Metrolist / ViMusic / SimpMusic** (Kotlin + Media3, closest to our stack).
- **YouTube.js** — how it does signature deciphering in JS.

Decide, with reasoning, between these three strategies and say why:

- **A. Token-free client + correct format.** Cheapest if it works. Needs proof it is not being rejected.
- **B. Signature deciphering.** Implement `nsig`/`sig` deciphering in JS (port from YouTube.js). Unlocks the
  ciphered formats we currently discard as unusable. Substantial work but removes a whole class of failure.
- **C. Never stream from YouTube; resolve-and-cache.** Download the full file to app storage via the app's
  existing download subsystem first (which may use a different, working path), then play from disk. Slower to
  start, robust once playing, and the downloader may already be functional — check whether it is.

State the trade-off honestly. If A is unprovable without a device test, say so and prefer the strategy whose
*failure mode* you can observe in the log.

### 4.3 Audit the rest of the playback code while you are in there

The user asked for this explicitly. Look for real defects, not style. At minimum:

- `usePlayer.ts` — the re-resolve loop: an error triggers `load(t)` from position 0 forever, with no backoff,
  no retry cap, and no user-visible reason. That is a machine for restarting songs silently.
- The stall watchdog polls every 3 s and calls `load(t)`, which resets position. Check `StallDetector` cannot
  misfire during buffering.
- `nativeDisabled` downgrades permanently after one failure.
- `signatureCipher`-only responses currently yield "no playable source"; the message the user sees should say
  what actually happened.
- State the specific file:line for every defect you find, and fix or file each one.

---

## 5. How you will be judged

1. **You did not ship a theory.** Every claim is backed by a log line from the device, a test, or a cited
   implementation in another client.
2. **The user can verify it.** A full track plays past 40 seconds, past 2 minutes, and to the end; the log
   contains the HTTP status lines proving it.
3. **You built the APK.** Tag it, confirm the workflow is green
   (`gh run list --workflow=android.yml --limit 1`), confirm the release asset exists
   (`gh release view <tag> --json assets --jq '.assets[] | "\(.name) \(.size)"'`), and give the user the exact
   download URL: `https://github.com/sadapay404/TheMashup/releases/download/<tag>/app-standard-release.apk`
4. **The test suite is green** and typecheck is clean, with new tests for anything you changed.
5. **You report honestly.** If you cannot fix it, say precisely what you proved and what remains unknown.
   A well-evidenced "here is the remaining unknown" beats a confident false claim. The previous engineer
   damaged this user's trust exactly that way, five times.

## 6. Tone

The user is frustrated and has been misled repeatedly. Do not open with a status report or a victory lap.
Do not say "this should fix it". Say what you verified, how, and what you could not verify. No filler.

## 7. Definition of done

- [ ] Diagnostics capture HTTP status, bytes, player errors and end-of-stream with duration
- [ ] A strategy is chosen from §4.2 with written reasoning and benchmark citations
- [ ] A full-length song plays end to end on `app.themashup.music` on API 36
- [ ] Playback code audited; defects fixed with file:line references
- [ ] `tsc` clean, 226+ tests pass, `npm run build` clean
- [ ] APK tagged, workflow green, release asset verified, download URL given
- [ ] Honest report of what was proven and what was not
