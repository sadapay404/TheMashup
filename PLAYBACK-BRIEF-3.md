# PLAYBACK BRIEF 3 — what actually changed in APK 45, and what is still unproven

**Date:** 2026-11-12 · **Branch:** `arena/0f8a3444-themashup`
**Tag:** `v0.3.0-apk.45` · **Last green commit:** `05df39d`
**Release:** https://github.com/sadapay404/TheMashup/releases/tag/v0.3.0-apk.45

Read §0 of `HANDOVER-BRIEF.md` first. It still applies and it is still the most important text in
this repository: **nothing is fixed until the user hears a song past 40 seconds.** This document is a
record of what was changed and how it was verified — not a claim that playback now works.

---

## 0. The two APKs, and which one matters

| file | size | what it is |
|---|---|---|
| `app-withNativeExtractor-release.apk` | 4.14 MB | **the only one that can play a whole song.** Contains NewPipeExtractor (GPL-3.0), which selects clients YouTube currently serves full-length URLs for, and performs signature deciphering. |
| `app-standard-release.apk` | 3.48 MB | no GPL code. Browser-side InnerTube ladder only. Works when a client happens to be token-free; otherwise it says so in one sentence. |

Both are signed with a **debug key on each CI runner** because the repo has no
`MASHUP_KEYSTORE_BASE64` secret. Consequence: if an older TheMashup is installed, Android will refuse
the update with "App not installed" and no explanation. Uninstall the old one first, or add the
keystore secret (`KEYSTORE_BASE64` → `MASHUP_KEYSTORE_BASE64`) and rebuild. The workflow now emits a
warning that names this.

---

## 1. Why songs stopped at ~30 seconds, and what was done

There were **six** independent reasons a *successful* resolve became silence. Five were in our code.

1. **The native extractor was never called.** The Kotlin seam existed and `MainActivity` installed it,
   but no Capacitor plugin exposed it, so `service.resolveStream` never asked. The GPL APK carried a
   working resolver that nothing used. Added `ExtractorPlugin` (`MashupExtractor`, methods
   `available` / `resolve`) and made the native rung *first* in `resolveStream`.

2. **Headers were dropped on conversion.** `streamInfoFromNative()` built the `StreamInfo` and threw
   away the `headers` the extractor reported. A URL issued for a `Referer` then 403s — which looks
   exactly like a dead stream. `headers` now lives on `StreamInfo` (`packages/core/src/domain.ts`), so
   it cannot be separated from the URL it belongs to, and is forwarded to `nativePlay` and to the
   downloader.

3. **A DASH/HLS manifest was "resolved but unplayable".** The converter produced `audio: []` for a
   manifest, so `pickAudioUrl` found nothing and the app said the track could not be played — for a
   track that had just been resolved successfully. A manifest is now described as the one playable
   track it is, keyed by a **negative** itag so it can never be mistaken for a real format. The
   download sheet greys it out rather than offering a `.mpd` as a file.

4. **Assigning `src` does not start playback.** The element path in `load()` set `el.src` and returned,
   trusting a caller that is a no-op when the element has no `src` attribute yet. It now calls
   `play()` and reflects a rejection (`playing: false`) instead of losing it.

5. **A press of play had nothing to resume into.** `nativeResume()` returns `false` when Media3 holds
   no media item; `setPlaying(true)` ignored that and set `playing: true` anyway. That is the frozen
   `0:00` with a pause icon. It now loads the current track instead.

6. **`!el.src` is not a reliable test.** Replaced at all eight sites by `elementOwnsPlayback()`, which
   uses `hasAttribute('src')`. The two agree for an untouched element but disagree after
   `removeAttribute('src')`, which is exactly the hand-over-to-Media3 state.

Also: the `video_track` fallback (no separable audio, but a muxed video stream exists) now plays the
muxed track and reports it instead of returning bare `null`.

---

## 2. What was removed, and why — read this before re-adding it

The PoToken WebView generator (`playback/poToken/*`, `assets/po_token.html`) was deleted.

**`YoutubeStreamExtractor.setPoTokenProvider(...)` in NewPipeExtractor v0.27.1 is a documented no-op:**

> "This method currently doesn't do anything, as the extractor doesn't use any client supporting
> poTokens until SABR support is added to the extractor."

So a provider could not have changed playback, and the port also could not compile (it overrode a
four-method interface that is now one method, and imported `kotlinx.serialization` and `okio`, neither
of which this module depends on). The extractor gets full-length URLs by *choosing clients that do not
need a token*. If a future version adds SABR support and starts calling the provider, reinstating one
becomes worth doing — not before.

**Do not describe the app as "minting PoTokens" anywhere.** It does not, and that claim is why three
builds were spent on code that could never run.

---

## 3. Build/toolchain facts learned the hard way

- `compileSdk = 35`, `targetSdk = 35` (`variables.gradle`). media3 1.6's AAR metadata and the
  extractor's APIs need 35.
- **Core library desugaring must be on** with `com.android.tools:desugar_jdk_libs_nio:2.1.5`.
  NewPipeExtractor requires the `_nio` variant below `minSdk 33`.
- NewPipeExtractor pin: `com.github.TeamNewPipe:NewPipeExtractor:v0.27.1` via JitPack. The workflow
  warms the POM first, because a cold JitPack 502 is indistinguishable from an unpublished artefact.
- **R8 (release minification) fails on Rhino's desktop-JDK references.** Complete set of missing
  packages: `javax.script`, `java.beans`, `jdk.dynalink`. All three are declared in
  `proguard-rules.pro`. If a new Rhino version is pinned, expect one more.
- A tag builds **both** flavours and fails if either APK is missing or has an invalid signature. It
  used to default to `standard`, which meant the only APK that could play a full song was never the
  one published.

---

## 4. Kotlin APIs that were wrong, and the correct ones

Every one of these cost a CI run. Check the source, do not guess.

| assumed | actual (v0.27.1 / media3 1.3.1) |
|---|---|
| `SessionCommands.Builder.addAllSessionCommands()` | does not exist; build from `MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.commands` then `.add(cmd)` |
| `YoutubeStreamExtractor` in `...services.youtube` | it is in `...services.youtube.extractors` — but see §2, do not call it |
| `PoTokenProvider` with four methods | one method: `getWebClientPoToken(String)` |
| `CommandButton` custom layout gives many notification buttons | true, **and** the commands must also be advertised in `onConnect` |
| `onSetMediaItems` receives a `MediaController` | it receives `MediaSession.ControllerInfo` |
| `onAddMediaItems` future is `MediaItemsWithStartPosition` | it is a future of the *list*; wrap with `Futures.transform` |
| `ItagItem.getItag()` | `ItagItem.id` (public final field) |
| `DataSpec.requestHeaders` | `DataSpec.httpRequestHeaders` |
| `DefaultMediaNotificationProvider.Builder.build()` returns the builder | it returns the provider (that is fine) |

`PoTokenResult.playerRequestPoToken` is `@Nonnull`, so passing `null` compiles in Java and crashes at
runtime. Not relevant while §2 holds, but know it.

---

## 5. What is verified, and what is not

Verified here:
- TypeScript strict typecheck, 281 unit/UI tests, production Vite build.
- CI green on the tagged commit.
- Both APKs assembled, R8-minified, `apksigner verify` → `SIGNED-VALID`, `aapt2` badging confirms
  `versionCode=45`, `targetSdk=35`, and the GPL build carries `versionName=0.3.0-apk.45-gpl`.
- The enhanced flavour **compiles** — this was the first time in the project's history that it did.
- TypeScript↔Kotlin contract checked by hand: every `invoke('Mashup…', 'method')` in `native.ts` has a
  matching `@PluginMethod`, and every `onNativeEvent('…')` name has a matching `NativeEvents.post`.
  There is **no automated check** for this; adding one would be worthwhile.

**Not verified:** anything on a device. No APK 45 has been installed. The native resolve path, the
header forwarding into ExoPlayer, the manifest fallback and the notification were exercised only by
compilation and unit tests.

---

## 6. If it still fails, get these three facts first

1. Which rung answered: Settings → Diagnostics, look for `resolve <id>: native WON` /
   `native unusable — installed=… flavour=… reason=…` / `InnerTube · <PROFILE>`.
2. The error event's `code`, `status` (HTTP), `positionMs` (how far it got) and `host`. The player
   already notifies with all four; do not "simplify" that message.
3. Whether the installed APK is the `-gpl` one. The standard APK reports
   `installed=false flavour=standard` and is expected to stop early; that is not the bug.
