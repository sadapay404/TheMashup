# Brief #2: TheMashup playback — the network problem

Supersedes `PLAYBACK-BRIEF-FOR-ANOTHER-AI.md`. That brief assumed playback was failing *after* a
stream resolved. The newest diagnostics show the opposite: **nothing resolves at all.** Read this
document, then read the code. Do not trust either — verify.

---

## 1. Repo and build constraints

```
https://github.com/sadapay404/TheMashup      (branch: arena/2732fac9-themashup)
```

- `apps/android` — Capacitor WebView + Media3/ExoPlayer service. `apps/web` — React/TS UI and all
  resolution logic. `packages/core` — InnerTube client, transports, parse, relays, recommend.
- Package id `app.themashup.music`. Device: moto g stylus 2025, **API 36**, Android 16.
- **No local Android toolchain.** No JDK, no SDK, no adb. Build only via GitHub Actions by pushing a
  tag: `git tag v0.3.0-apk.NN && git push origin v0.3.0-apk.NN`. Current release: `v0.3.0-apk.35`.
  The workflow derives `versionName` from the tag (`0.3.0-apk.NN`). Asset: `app-standard-release.apk`.
- `gh run view --log` / `gh run download` fail here (EOF). Use
  `gh api repos/sadapay404/TheMashup/check-runs/<job_id>/annotations --jq '.[].message'`.
- The sandbox **cannot reach YouTube/Piped/Invidious** (TLS-blocked). You cannot test resolution.
  Design around that: make the app report, and reason from the user's paste.
- Keep `npx tsc -p apps/web/tsconfig.json --noEmit`, `cd apps/web && npx vitest run` (227 tests) and
  `npm run build` clean before every tag.

---

## 2. The evidence — two diagnostic runs, one device, two different stories

Both are from the user tapping *Run Diagnostics* in Settings on their phone.

**Run A — 2026-11-10T11:12:51Z**
```
[PASS] Direct InnerTube request — HTTP 200 from music.youtube.com
[PASS] Search via active route — 20 song results · public API · piped.ducks
[PASS] VISIONOS player — 27 formats, direct URLs
[FAIL] TVHTML5 player — 0 formats, ciphered only
```

**Run B — 2026-11-10T12:17:00Z** (build `0.3.0-apk.35`)
```
verdict: Search is blocked on this network
[PASS] Direct InnerTube request — HTTP 200 from music.youtube.com
[FAIL] Search via active route — No search route answered ...
[FAIL] Stream resolution — no stream resolved — VISIONOS:blocked ANDROID_VR:blocked
       TVHTML5_SIMPLY:blocked TVHTML5:blocked IOS:blocked ANDROID:blocked WEB_REMIX:blocked
[FAIL] VISIONOS player — blocked — using another rung
[RUN ] TVHTML5 player          <-- never finished
```

**The contradiction that matters:** the same build reports `HTTP 200 from music.youtube.com` as
PASS *and* all seven player rungs as `blocked`. Both are InnerTube calls to the same host. One of
these two lines is lying, or they are going through different transports/paths. Until that is
explained, no theory about playback is worth anything.

Also note: Run A produced direct URLs (in a different build, `.31`), Run B produces nothing. Either
the network changed, the IP changed, or the build changed behaviour. The user is on a mobile network
in Pakistan. Search worked at 11:12 via `piped.ducks` and failed at 12:17.

**Historical fact from `apk.31`:** the app rendered **1438080 frames at 48 kHz = 29.96 s** of audio
and then stopped, with no `onPlayerError` in logcat. So at that time *something* played for exactly
~30 s. That is consistent with a PoToken-gated stream serving ~1 MB then 403-ing (see §4).

---

## 3. What is wrong with the diagnostics themselves

Fix these first — the user is being asked to debug the app with a gauge that lies.

1. **`[RUN]` is a dead state.** `TVHTML5 player` shows `RUN` forever in Run B. The check loop
   `break`s out of `STREAM_LADDER` as soon as a rung wins, so later rows never reach an end state.
   Any check that is not reached must be set to a terminal state ("skipped") before the report prints.
2. **"blocked" means nothing.** In `apps/web/src/lib/service.ts`, `resolveStream` does
   `catch { continue; }`. The actual error object is discarded. Log:
   `k` (Capability/Network/Upstream/Parse), `status`, `cause`, `missing`, `endpoint`, and which
   transport route was in play (`this.transport.health.lastRoute`). One line per rung.
3. **`blocked` conflates causes.** A missing plugin, a CORS rejection, a DNS failure, a 403 and a
   timeout all print the same word. Read `apps/web/src/lib/service.ts:140` and note this:
   ```ts
   this.transport = new TransportChain(undefined, false, isDesktop() ? desktopFetch : undefined);
   ```
   `desktopFetch` — the `CapacitorHttp` socket path that bypasses CORS entirely — is only wired when
   `isDesktop()` is true. Confirm whether the Android shell is treated as desktop. If it is not, the
   native HTTP transport documented as "native first" is **not installed inside the APK**, and every
   InnerTube call in the app is a browser `fetch` from a `https://localhost` WebView origin straight
   into music.youtube.com. If that is the case it is a strong candidate for everything above.
4. **The single check conflates two paths.** `Direct InnerTube request` posts with a raw `fetch`
   against `PROFILES.WEB_REMIX`; the ladder goes through `TransportChain`. Split it into
   "InnerTube via transport chain" vs "Piped relay" vs "Invidious relay" with status and timing for
   each.
5. Persist the last diagnostics run to storage so the user can export it with the rest of the log
   instead of transcribing it.

---

## 4. Domain knowledge you need (verified, with citations)

- **PoToken gating is byte-based, not time-based.** YouTube's media host serves roughly the first
  megabyte of a gated stream, then answers HTTP 403:
  <https://code.thetadev.de/ThetaDev/rustypipe/src/branch/main/notes/po_token.md>. At 256 kbps that
  is ~31 s — the exact 29.96 s the user saw. Any change that only reorders clients without removing
  the gate will reproduce the same 30-second stop.
- **Which clients are token-free** (as of writing) — `yt-dlp` PO Token Guide:
  <https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide>. `android_vr` is listed as not requiring a
  token, but note yt-dlp issue #17348 (`android_vr` now needs a GVS token for everything but format
  18) and that `clientVersion > 1.65` may return SABR only. **This is A/B tested and changes.** Any
  client table is a snapshot, not a fact.
- **Ciphered formats need player-JS deciphering.** We have no JS interpreter, so `signatureCipher`
  entries are unusable and must never be selected (this is already handled in `pickAudioUrl`, verify
  it stays true).
- **What "drift" looks like:** `apps/web/src/lib/service.ts` passes
  `this.visitorData = readLocal(LS_VISITOR) ?? makeVisitorData()`. A visitor id minted locally (rather
  than one issued by YouTube) is a real cause of bot-checking and of every player call returning
  `LOGIN_REQUIRED`/`UNPLAYABLE`. Check `makeVisitorData()` and `parsePlayer`'s `playabilityStatus`
  handling against what YouTube actually returns.

---

## 5. Your mandate

1. **Resolve the contradiction in §2 first.** It is the fork in the road. Either the direct probe is
   measuring something other than what the ladder attempts, or the transport differs. Prove which,
   citing the code path and, where possible, a test.
2. **Then rank the candidate causes with evidence**, not intuition:
   - native HTTP transport not installed in the Android shell (`isDesktop()` check)
   - CORS from the `https://localhost` WebView origin against `music.youtube.com`
   - missing/invalid PoToken and locally-minted `visitorData` triggering bot checks
   - the network genuinely blocking YouTube endpoints on that mobile carrier (test by making the app
     report DNS/TCP-level results, not just fetch rejections)
   - a build regression between `.31` (which resolved) and `.35` (which does not) — **diff them**:
     `git diff e5945dd..HEAD -- packages/core/src/innertube apps/web/src/lib`
3. **Fix playback with a mechanism you have proven.** For each candidate, state the observation that
   would confirm or kill it, and make the app produce that observation. If you cannot observe it
   without the device, say so and pick the strategy with an observable failure mode.
4. **Audit the rest of the playback path** and fix real defects, each with `file:line`:
   - `usePlayer.ts` error handler re-resolves and replays from 0 with no backoff, no retry cap, no
     user-visible reason.
   - The 3 s stall watchdog also calls `load(t)` and resets position.
   - `nativeDisabled` is a permanent downgrade after one failure.
   - A truncated stream that ends "cleanly" is reported as `STATE_ENDED`, so the app may believe the
     song finished and auto-advance.
5. **Build it.** Tag, verify the workflow is green and the asset exists, give the user the exact URL:
   `https://github.com/sadapay404/TheMashup/releases/download/<tag>/app-standard-release.apk`

## 6. Definition of done

- [ ] Diagnostics have no `RUN` dead states; every row ends pass/warn/fail/skipped
- [ ] Every failed rung logs typed error + status + route, not the word "blocked"
- [ ] The §2 contradiction is explained in writing, with the code path that causes it
- [ ] A full song plays past 2 minutes and to the end, proven by a log line, not asserted
- [ ] Playback defects audited with `file:line`; each fixed or explicitly filed
- [ ] `tsc` clean · 227+ tests pass · build clean · APK tagged, green, asset verified
- [ ] Honest report: what was proven, what was not, what remains unknown

## 7. Tone

The user has been failed repeatedly by confident wrong diagnoses, including by the author of this
brief. Do not open with a status summary. Do not use the words "this should fix it". State what you
verified and how. If the answer is "your carrier blocks YouTube and the app needs the native socket
path", say exactly that, with the evidence.
