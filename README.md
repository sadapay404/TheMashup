# TheMashup

A serverless music streaming and downloading app. No backend, no hosting bill, no analytics.
Search, stream, karaoke-synced lyrics, fuzzy lyric search and downloads all run on the device.

- **Web** — React 19 + Vite, runs from any static host (or `file://`)
- **Android** — Capacitor shell + Media3 background playback, built by CI
- **Desktop** — Tauri 2 shell: native HTTP (no CORS, no relays), tray, media keys

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm run typecheck    # strict TS, zero errors
npx vitest run --root apps/web    # 63 tests
npm run build        # 147 KB gzip
```

**APK:** GitHub → Actions → *Android APK* → Run workflow → download the `themashup-apk` artifact.

**Desktop:** push a `desktop-v*` tag (or run the *Desktop* workflow) → download `windows-app` / `linux-app`.

## How it stays serverless

| Problem | Solution |
|---|---|
| Browsers can't call `music.youtube.com` (CORS) | **Native builds:** requests leave from Rust — no origin, no CORS, no relays. **Browser:** public Piped/Invidious APIs |
| Stream URLs are token-gated | A profile ladder ordered by *freedom from tokens* (`VISIONOS` → `TVHTML5` → …) |
| Lyrics search needs full text | On-device BM25 index over lyrics already cached, plus upstream fallback |
| Recommendations need a model | Upstream radio re-ranked locally with an affinity graph and ε-greedy exploration |
| Background audio dies in a WebView | Native Media3 `MediaSessionService` in the Android build |

## Honest notes

- FLAC is a **lossless container for a lossy source** (YouTube's ceiling is 256 kbps AAC / ~160 kbps
  Opus). The UI says so on every download card.
- 4K H.264 does not exist; 1440p/2160p are VP9/AV1, so those tiers are offered as WebM/MKV.
- Account sign-in uses **cookie capture**, not OAuth: Google's installed-app flow requires a
  `client_secret`, which cannot ship in a public app.
- Public API instances are community-run. Settings → Diagnostics tells you which one answered.

## Docs

`docs/00-MASTER-PLAN.md` → architecture, ADRs, API strategy, storage/reliability, download engine,
design system, and a report per phase.

## Licence

MIT. The optional `withNativeExtractor` Android flavour links NewPipe Extractor (GPLv3) and is
distributed separately; the default artefacts contain no GPL code.
