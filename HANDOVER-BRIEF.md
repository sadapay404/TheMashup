# TheMashup — full handover brief

**Written by the outgoing agent. Read this whole file before touching code.**
**Date:** 2026-11-08 · **Repo:** `sadapay404/TheMashup` · **Branch:** `arena/2732fac9-themashup`
**HEAD:** `0cdb893` · **Tag:** `v0.3.0-apk.38` · **Delivered APK:** `app-standard-release.apk` (3,637,923 B)

---

## 0. Read this first

The user is not asking for an explanation. He is asking for songs that play all the way to the end.
Ten reports in, that has not happened. He has been told "fixed" more than once and it was not true.
**Do not tell him anything is fixed until he reports hearing a full song.** That is the only evidence
that counts. Everything else — green CI, passing tests, a resolved URL in a log — is not evidence.

Two standing rules he stated directly and that you must not talk your way out of:

> **"if you found the exact 90%+ chance issue, build the app with realtime song player otherwise, build the downloader."**

> **"There would be many more. i just noticed some. Examine the full app from top to bottom"**

The second is a standing mandate: he expects you to audit everything, not just the thing he named.

---

## 1. What the app is

A music player. TypeScript/React web UI in a Capacitor Android shell, plus a Tauri desktop shell.
It has no server. It resolves audio by talking to YouTube Music's private InnerTube API directly
from the client, and falls back to public Piped/Invidious instances. Downloads go through a Kotlin
foreground service.

```
apps/web/          React 19 + Vite UI, the whole product
apps/android/      Capacitor 6 shell, Kotlin: Media3 playback, download service, plugins
apps/desktop/      Tauri shell (secondary; do not let it distract you)
packages/core/     InnerTube client, format parsing, Piped/Invidious provider, recommender
docs/              Design + ADRs. 00a-DECISIONS-LOG.md is the honest history.
PLAYBACK-BRIEF-FOR-ANOTHER-AI.md   earlier handover, still accurate on the network layer
PLAYBACK-BRIEF-2.md                earlier handover, download/quality phase
```

**Device under test:** moto g stylus 2025, Android API 36, package `app.themashup.music`.

---

## 2. The end goal, stated plainly

**A song, once started, plays to its last second.** Not 30 seconds, not "about a megabyte then
silence", not a restart from the intro. And when it cannot play, the app says why in words that
mean something, instead of spinning.

Everything else — the dock, the sheet animations, the download library, the recommender — is
secondary. The player is the product.

---

## 3. The two hard problems, in order

### Problem A — streams die mid-song (the original, still unsolved)

**Symptom:** a track starts, plays for a while, then stops. Historically "about a megabyte" then a
403. Sometimes it plays a `WEB_REMIX` preview of ~30 s.

**What is known, and confirmed in code:**

* It requests `playbackContext` / `streamingData` from **InnerTube player endpoints** using a
  per-client profile table in `packages/core/src/innertube/profiles.ts`.
* The ladder, in order, is `STREAM_LADDER`:
  `VISIONOS → ANDROID_VR → TVHTML5_SIMPLY → TVHTML5 → IOS → ANDROID → WEB_REMIX`
* Several clients (`WEB_REMIX`, `ANDROID`, `IOS`, and `ANDROID_VR` in practice) return URLs that
  **require a stream PoToken**. Without one, the CDN serves ~1 MB and then 403s. The app cannot mint
  PoTokens, because that requires running BotGuard, which requires a JS VM plus a Google-attested
  challenge. This is the central constraint.
* `PROFILES[...].needsStreamPoToken` drives the picker: on a gated client it picks the *cheapest*
  stream, because that plays longest before the cut.
* **`pickAudioUrl()` accepts a URL that has no PoToken at all.** It checks only that a URL string
  exists (`info.urls[f.itag]`). It does not check for a `pot` parameter. So a gated client's URL is
  happily returned and dies at ~1 MB. **This is a plausible root cause and has never been closed.**
  Read `packages/core/src/innertube/parse.ts:460-489`.
* Transport: `packages/core/src/net/transport.ts`. Browsers cannot POST to `music.youtube.com`
  (no CORS), so there is DIRECT → relay ladder. **In the Capacitor shell there is no native
  transport registered** — `service.ts:162` passes `undefined` for native and only wires
  `desktopFetch` for Tauri. Capacitor's `CapacitorHttp` is enabled in
  `apps/android/capacitor.config.json` but there is no Kotlin/JS code setting it up, and it does not
  bypass WebView CORS anyway. **So on the phone, every InnerTube player POST depends on a public
  relay proxy.** The Settings diagnostics say `Direct InnerTube request — Can this browser POST to
  music.youtube.com?`, which on Android the honest answer is *no*. Verify what that check actually
  reports on the device; it may be lying.
* A previous device diagnostic run reported `[PASS] Stream resolution — VISIONOS · itag 251 @
  160kbps · token-free, should play through`. That is a *resolution* pass, not a playback pass. It
  proves a URL came back; it says nothing about whether the URL survives 30 seconds.

**What has NOT been tried:** checking for the `pot` parameter and refusing gated URLs outright;
ABR/range-request behaviour of Media3 vs. the CDN; whether the cut is `403` at byte N (which would
point square at PoToken) versus a stalled socket (which points at the CDN/relay); format 18
(muxed 360p, the one format that historically never needed a token).

**What would settle it in one run:** capture the *exact* HTTP status and byte offset at which
playback stops. That single number separates "token-gated" from "network stall" from "expired URL".
The app has a diagnostics ring buffer (`mashup.diagnostics` in localStorage, 200 entries,
`components/shell/Boundary.tsx`) and `nativeBootMark()` lines that record
`profile=… itag=… kbps=… preview=…`. **Read those off the device before theorising.**

### Problem B — "No playable source" on the download page (new regression)

**Symptom:** opening the download sheet now shows no formats / no playable source.

**Where it comes from:** `apps/web/src/lib/service.ts:387`:
```
No playable source (tried ${tried.join(', ')} and the public API ladder).
```
This is reached only after: every rung of `STREAM_LADDER` failed or returned no direct URL, **and**
the `PublicApiProvider` ladder (`packages/core/src/net/piped.ts`, 6 Piped + 2 Invidious instances,
9 s timeout each) returned nothing.

Note the last-rung special case at `service.ts:359` — if the final ladder entry returns any audio at
all, it is accepted *even with no direct URL*, so the sheet can render rows that are all locked. Check
whether that is what he is seeing: "no playable source" text versus a sheet of locked rows.

**Prime suspect, and it is a real defect I introduced but did not cause:** the Piped/Invidious
instances are the fallback for everything on Android, because there is no native transport (see
above). If those hosts are blocked by the user's network in Pakistan (they routinely are — the
Settings screen's own advice text says "very common on mobile data and in some regions"), then
search degrades *and* resolution has no fallback at all. The app's entire stream path is one
third-party dependency deep on the exact network where it is being tested.

**Do not** assume download-page failure is a UI bug. The download sheet resolves its own stream via
`service.resolveStream(track.id)` in `components/player/DownloadSheet.tsx`. If resolution is failing
globally, playback is failing too. Check the Play flow before the Download flow.

---

## 4. Your answer to his question: can we use NewPipe / yt-dlp?

**He asked directly. Answer him plainly, then act.**

### NewPipe Extractor — yes, and the project is already shaped for it

`NewPipeExtractor` is Java/Kotlin, runs on-device, and is the most mature Android extractor. It
handles signature deciphering and the client handshake properly. The repo has the seam already:

* `apps/android/.../extractor/ExtractorService.kt` — `interface StreamExtractor`, `object Extractor`
  with a `@Volatile var delegate`, resolved reflectively at `MainActivity.kt:47`.
* `apps/android/android/app/build.gradle.kts` has product flavours `standard` and
  `withNativeExtractor`, and the GPL dependency is wired:
  `"withNativeExtractorImplementation"("com.github.TeamNewPipe:NewPipeExtractor:v0.24.6")`
* **BUT the seam is a dead end today.** `BuildConfigStreamExtractorDelegate.create()` does
  `Class.forName("app.themashup.music.extractor.generated.NativeExtractorImpl")`, and **that class
  does not exist anywhere in the repo.** There is no `src/withNativeExtractor/` source set. I
  checked: `find apps/android/android/app/src -maxdepth 1 -type d` → only `main`.
  So the reflective load always returns null, `Extractor.delegate` is always null, and
  `Extractor.resolveStreamUrl()` always returns null. **The NewPipe path has never existed.**
* Also: every release so far ships **only** `app-standard-release.apk`. No `-gpl` APK has ever been
  published. So even if the class existed, he has never been given a build that contains it.

**What to do:** write `src/withNativeExtractor/java/app/themashup/music/extractor/generated/NativeExtractorImpl.kt`
implementing `StreamExtractor` against `NewPipe.getServices()` + `YoutubeStreamExtractor`, and make
CI build and attach `app-withNativeExtractor-release.apk` alongside the standard one. Note the
licence consequence honestly: NewPipeExtractor is **GPL-3.0**, so that APK is GPL. That is why the
flavour split exists (ADR-005). He should be told which APK is which, in one sentence, without a
lecture.

### yt-dlp — no, not on Android, and not as-is

yt-dlp is Python. Shipping it means embedding CPython or running a `python` binary on the device:
huge, fragile, and it needs network access to fetch its own JavaScript runtime for some extractors.
There is no maintained Android port that is not a wrapper around exactly this problem. What people
usually mean by "use yt-dlp" is "use the client profiles yt-dlp uses", and that is already what
`profiles.ts` does — the comment on `VISIONOS` says so explicitly. **The profiles are not the gap.
The gap is that this app cannot run `solveJS`/BotGuard, so any client that demands a PoToken will
never work here no matter how the headers are set.** NewPipe mostly sidesteps that by using the
clients that don't ask, and by maintaining the dance as Google changes it — which is the real value
of taking the dependency rather than reimplementing it.

### The other option, stated honestly

There is a third path the project has never taken and that you should at least price out:
**resolve server-side** (a tiny Vercel function; he has Vercel connected) so the PoToken problem is
solved once, off-device, by a process that can run a JS VM. That breaks the "no server" property the
whole design is built on, so it is a decision for him, not for you. Mention it in one paragraph.

---

## 5. State of the code as you receive it

**Green and verified:** `npm run typecheck` clean, `vitest run` 256 tests / 23 files, `npm run build`
~2.7 s, CI workflow `android.yml` green, APK builds and releases on tag push.

**The last four fixes (in `0cdb893`), all real, none device-verified:**

1. `DownloadService.kt` — the foreground notification said `"Preparing download…"` forever because
   it was built once and never re-posted. Now re-posts real progress; completion/failure posts under
   a separate id (`NOTIF_ID_RESULT`) because `finally` calls `stopForeground(STOP_FOREGROUND_REMOVE)`
   and would otherwise erase the result instantly. OkHttp gained `writeTimeout` and `callTimeout`.
2. `downloader.ts` — 45 s watchdog on the native path and the browser path; `cancelDownload`,
   `removeDownload`, `clearFinishedDownloads`, `retryDownload` (re-resolves, because URLs expire).
   Downloads screen gained Stop / Retry / Clear.
3. `lib/overlays.ts` — an overlay stack; `App.tsx` `__mashupBack` calls `dismissTopOverlay()` first.
   `AddToSheet` and `DownloadSheet` now `createPortal(…, document.body)` and register. This fixed a
   genuine trap: `position: fixed` inside the page container's `motion.div` (which animates
   `scale`/`y`) resolves against *that ancestor*, so the backdrop had almost no tappable area.
   A shared `Sheet` primitive in `components/ui/primitives.tsx` replaces two duplicates.
4. `MainActivity.onBackPressed` now sets `settled` on the success path too — it used to only be set
   inside `finishOnce`, so a successful web-side back still let the 900 ms fallback finish the
   activity. And `restoreOnce()` in `App.tsx` now rebuilds `navHistory`; it used to restore `route`
   only, leaving `navHistory: ['home']`, so `goBack()` returned false on the first press every
   session after reopening on any page but home.
5. `usePlayer.ts` — `load(track, resumeAt)`. **Every stall-recovery path used to call `load(t)`,
   which unconditionally wrote `positionSec: 0`.** A stall at 2:10 replayed the intro; a second
   stall replayed it again. This is a genuine, previously undiscovered cause of "the song doesn't
   play in full". Applies to Media3, the `<audio>` element, and the local-file path.

**Known-weak, do not trust:**

* `service.ts:162` — no native transport in the Capacitor shell (Problem A, above).
* `pickAudioUrl()` — accepts token-gated URLs (Problem A, above).
* The `withNativeExtractor` flavour — a reflective load pointing at a class that does not exist.
* Any claim marked "verified" in an earlier commit message that was not checked on his device.

---

## 6. Environment facts you will trip over

* **This sandbox has no Android SDK and no Kotlin compiler.** You cannot compile Kotlin locally.
  CI is the only compile. Never claim an Android change works without a green CI run.
* **The sandbox TLS-blocks YouTube.** You cannot test resolution here at all. Do not pretend a
  passing local test proves anything about the device.
* Public Piped/Invidious availability is unstable and varies by country. Assume they are down for
  him unless proven otherwise.
* `gh release download` and `gh run view --log` fail with TLS EOF here. Use
  `gh api …/check-runs/<id>/annotations` and `gh release view --json assets`.
* `git commit` needs `-F file`; heredocs into `-m` misbehave.
* `exactOptionalPropertyTypes: true`. A mocked `Response` body is single-use.
* Release flow: push commit → `git tag -a v0.3.0-apk.NN` → `git push origin <branch> --follow-tags`
  → CI builds `standard` only → APK attaches to the GitHub Release. Version code is parsed from the
  tag name by `sed -n 's/.*apk\.\([0-9]*\).*/\1/p'`, so **the tag number must be the version code**.

---

## 7. What to do, in order

1. **Get evidence before writing code.** Have him (or the app) produce the diagnostics blob from
   Settings → Diagnostics → copy, and the `nativeBootMark` / `diag()` lines. You need: which profile
   won last, whether a URL had `pot`, and the HTTP status + byte offset at the moment audio stopped.
   Problem A cannot be closed by reasoning; it has been reasoned about ten times.
2. **Fix Problem B's honesty immediately.** Whatever `resolveStream` returns, the download sheet must
   distinguish "this network cannot reach any resolver" from "this track has no usable format". Those
   are different sentences and he is currently being shown neither.
3. **Build the `withNativeExtractor` flavour properly** and ship both APKs. This is the highest-value
   change available: it takes the PoToken problem off the device and puts it in a maintained
   library. Everything is wired except the ~80-line implementation class and the CI step.
4. **Then** re-run the audit mandate. He is right that there are more. Known open items worth
   checking: the `[RUN]` row that never settles (was fixed in `SettingsScreen.tsx`, never confirmed
   on device); whether `Direct InnerTube request` diagnostics reports the truth on Android; whether
   `ANDROID_VR`/`TVHTML5_SIMPLY` still behave as `profiles.ts` claims.
5. **Update `PLAYBACK-BRIEF-2.md` and `PLAYBACK-BRIEF-FOR-ANOTHER-AI.md` as you go.** He asked for
   those to be kept intact and they are the project's memory.

---

## 8. How he judges you

He has said: *"You just can't do it."* and *"I AM NOW TIRED."* Both were earned. He is testing on a
real phone on a network that fights this app, and he has heard the same promises repeatedly.

What will make him trust you:
* One working song, all the way through, on his device.
* A specific cause named before a fix, not after.
* Being told when something is unverified instead of being told it is fixed.
* Not being given a fourth explanation of the same failure.

What will lose him permanently: saying "fixed" without device evidence. That has already happened
several times. Do not make it eleven.
