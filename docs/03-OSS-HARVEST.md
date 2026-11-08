# TheMashup — Open-Source Harvest & Licence Matrix

> **Document 3 of 5 — Phase 0 deliverable**
> This document exists so that "harvest battle-tested modules" is an engineering plan with named
> obligations, not a hand-wave.

---

## 1. Sourcing Policy

**Three tiers, strictly applied:**

| Tier | Meaning | Constraint |
|---|---|---|
| **A — Pattern harvest** | We study behaviour/protocol and re-implement in TypeScript or Kotlin from scratch. | No source copied. Clear of licence obligations. |
| **B — Optional dependency** | Compiled/linked only in a non-default build flavor behind a port. | Licence obligations documented and disclosed in-app (Settings → Open Source). |
| **C — Forbidden** | Copy-paste of GPL/AGPL source into our tree; bundling of DRM-bypass tools; redistributing media. | Never. CI check greps for licence headers of Tier A projects. |

---

## 2. Per-Project Harvest Table

### 2.1 OuterTune — Google Sign-In + InnerTube shapes
> GPLv3 · Kotlin/Compose · fork of InnerTune · Android-first

| Harvested | Tier | Re-implementation plan |
|---|---|---|
| Google **OAuth device-code** flow against `oauth2.googleapis.com/device/code` with scopes `https://www.googleapis.com/auth/youtube` (readonly variant) | A | `packages/core/src/auth/deviceCode.ts` — poll loop with `slow_down`/`interval` handling, exponential ceiling, cancel token. Token exchange stays in the client (public client, no secret). |
| InnerTube request envelope for `WEB_REMIX`: `context.client.{clientName, clientVersion, hl, gl, visitorData}` | A | `innertube/client.ts` — a `RequestEnvelope` builder with a per-profile context table. |
| Auth header shape: `Authorization: SAPISIDHASH <ts>_<sha1(ts + SAPISID + origin)>` with `Cookie: SAPISID=…` | A | Implemented in `auth/sapisid.ts` using WebCrypto. Requires cookies to be readable → **Android-only** path; web falls back to bearer-token requests. Documented limitation. |
| Radio id conventions (`RDAMVM<videoId>`, `RDEM…` for artist radio) | A | `recommend/seeds.ts` with a table of id prefixes and validation. |
| Queue/gapless rules, skip-after-N-seconds, "play next / add to queue" semantics | A | `packages/playback/queue.ts` XState machine. |
| **Not taken** | — | Compose UI, Room schema, Hilt DI, Kotlin data layer. Not portable, and the UI must be ours. |

### 2.2 LibreTube — notification & background lifecycle
> GPLv3 · Kotlin · Android-first

| Harvested | Tier | Re-implementation plan |
|---|---|---|
| `MediaSessionService` + `ExoPlayer` notification lifecycle: channel creation, `MediaSession` callback wiring, `setForeground`, wake-lock policy, "audio focus duck/pause" rules | A | Kotlin plugin `Media3PlaybackService` (Phase 3). Our own code, modelled on the documented Media3 contract plus LibreTube's field-proven edge-case handling. |
| Long-download foreground service rules (Android 14 `dataSync` foreground type, 6-hour cap, user-visible cancel) | A | `DownloadForegroundService` with `dataSync` type + explicit `POST_NOTIFICATIONS` gating. |
| Proxy-first transport ladder when direct requests are blocked | A | Our `TransportPort` relay chain (ADR-001). |
| **Not taken** | — | Compose UI, their account system, SponsorBlock (possible v2 feature). |

### 2.3 NewPipe Extractor — signature/cipher knowledge
> GPLv3 · Java · a *library*, not an app

| Harvested | Tier | Notes |
|---|---|---|
| Knowledge of `signatureCipher` / `n` parameter transformation and the `player` JS function constraints | A (knowledge) | We implement `sig/` strategies from protocol observation. |
| Ready-made extraction when InnerTube fails | **B — optional** | `NativeExtractorBridge` in build flavor `withNativeExtractor`. GPLv3 disclosure + written offer of source, surfaced in-app under Settings → Open Source. Default flavor ships **without** it. |
| PoToken/BotGuard handling | B (optional, same flavor) | Same boundary. |

### 2.4 Reference-only UX
Ryder, SimpMusic, ViMusic, Metrolist — studied for gesture conventions (swipe-to-queue, mini-player
expansion physics, lyric karaoke timing). **No code, no assets.** Our visual language is original
(see `04-DESIGN-SYSTEM.md`).

---

## 3. Licence Obligations Summary

| Deliverable | Contains GPL code? | Distribution obligation |
|---|---|---|
| Default web build | No | Our own licence (TBD by user). |
| Default Android APK (`standard` flavor) | No | Same as web. |
| Android APK (`withNativeExtractor` flavor) | Yes (NewPipe Extractor, GPLv3) | Full corresponding source must be offered; app shows the offer + licence text; our app's licence must be GPLv3-compatible for that flavor. |
| Windows build (Tauri) | No | Same as web. |

**CI guard:** `tooling/check-licences.mjs` fails the build if a `standard`-flavor artifact contains a
known GPL header signature, and generates `THIRD-PARTY-NOTICES.md` from `package.json` licenses.

---

## 4. What We Deliberately Do Not Build

- ❌ No server-side cache, no "premium unlock", no credential sharing.
- ❌ No DRM circumvention. We only use streams a normal client can obtain.
- ❌ No bundled media, no bundled account.
- ❌ No proxy we operate (relays are user-configurable third-party lists).
- ❌ No telemetry of any kind.
