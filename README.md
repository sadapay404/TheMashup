# TheMashup

One local-first music player: **aggregated streaming, smart search, synced lyrics,
downloads, radio and personalized recommendations** — Express gateway + Python
resolver + React web, in a pnpm monorepo. Desktop (Tauri) and Android (Capacitor)
shells wrap the same web UI in later phases.

## Quick start

```bash
pnpm setup          # install workspace deps + resolver venv (once)

# terminal 1 — resolver (:8000) + gateway (:4000)
pnpm dev

# terminal 2 — web app
pnpm --filter @themashup/web dev      # → http://localhost:8080
```

Or step by step:

```bash
pnpm install
bash scripts/setup-resolver.sh
pnpm --filter @themashup/api dev
bash scripts/dev-resolver.sh
pnpm --filter @themashup/web dev
```

- **Web preview:** http://localhost:8080 (Vite proxies `/api` → gateway → resolver)
- **Demo auth** works out of the box (`Sign in → demo`) — Supabase/Google OAuth is
  optional, see [`docs/SETUP_AUTH.md`](docs/SETUP_AUTH.md).
- Sandbox/offline mode: `RESOLVER_MOCK=1` + `MOCK_UPSTREAM=1` make every flow
  (including downloads) fully testable without YouTube egress.

## What's inside

| Area | Highlights |
|---|---|
| Playback | Singleton Web Audio engine — `<audio>` → Analyser → Gain; automatic source failover, seek-safe, Range-proxy streaming |
| Search | Typeahead + hybrid search: free text **or** pasted lyrics → fuzzy-matched lyric rows |
| Lyrics | LRCLIB synced/plain lyrics with karaoke highlighting |
| Recommendations | Charts shelves for guests; **Listen Again** + taste-vector **Discover** when signed in |
| Downloads | Quality picker (MP3 128/320, FLAC, Opus, MP4 360p→4K), live SSE progress, bundled static ffmpeg, files survive resolver restarts |
| Themes | 5 persistent themes (frosted, paper-ink, neon, aurora, vinyl) + dynamic album-art colors |
| Library | Likes, playlists (drag-reorder), history, follows — Supabase RLS or local JSON fallback |
| **Native Android** | **Full Kotlin/Compose rewrite in `android/` — no PC required, same design (see docs/ANDROID.md)** |

## Commands

```bash
pnpm test          # shared + api + web + resolver suites
pnpm typecheck     # 3 TypeScript packages
pnpm build         # production web bundle
pnpm desktop:dev   # Tauri dev window (needs Rust — see docs/DESKTOP.md)
pnpm desktop:build # package the Windows app
pnpm mobile:sync   # build web + copy into the Capacitor Android project
pnpm mobile:apk    # sync + gradlew assembleDebug (needs JDK/SDK — see docs/MOBILE.md)
```

## Repo map

```
packages/shared     types, constants, ranking/lyrics/radio/recommend utils + tests
apps/api            Express gateway :4000 (auth, library, downloads, SSE, proxies)
apps/web            React app (Vite) :8080
desktop/src-tauri   Tauri shell (Phase 7) — media keys, tray, native save dialogs
mobile/             Capacitor Android project (Phase 8) — superseded by android/, left untouched
android/            Native Kotlin/Compose rewrite (phases N1–N8) — no PC required
services/resolver   FastAPI :8000 (search/stream/lyrics/downloads, yt-dlp + ffmpeg)
supabase/migrations Postgres schema (auth, library, embeddings, RLS)
docs/               ARCHITECTURE.md · API.md · SETUP_AUTH.md · DESKTOP.md · MOBILE.md
```

## Phases

| # | Deliverable | Status |
|---|---|---|
| 1 | Architecture & blueprint | ✅ |
| 2 | Gateway + resolver + core APIs | ✅ |
| 3 | Web player shell, engine, themes, lyrics | ✅ |
| 4 | Auth + library + smart search | ✅ |
| 5 | Downloads + recommendations | ✅ |
| 6 | Animations, visualizer, stress tests, PWA, live preview | ✅ |
| 7 | Tauri desktop shell (media keys, tray, native saves) | ✅ |
| 8 | Capacitor Android APKs (scoped-storage saves, lock-screen controls, background runner) | ✅ |

### Native Android rebuild (Kotlin + Compose — see `docs/ANDROID.md`)

| # | Deliverable | Status |
|---|---|---|
| N1 | Blueprint + buildable Compose skeleton (`android/`, 5-theme shell, syntax gate) | ✅ |
| N2 | Pure-Kotlin domain core + local data layer (ported algorithms, JSON repositories) | ✅ |
| N3 | Extraction + lyrics networking (NewPipe, LRCLIB, fallbacks) | ✅ |
| N4 | Player engine (Media3, queue/failover, lock-screen service) | ✅ |
| N5 | Shell + 5 themes + Home/Search UI | ✅ |
| N6 | Library + lyrics/karaoke + expanded player | ✅ |
| N7 | Downloads (first-run ffmpeg, scoped storage, progress) | ⏳ |
| N8 | Recommendations + motion/visualizer + release polish | ⏳ |

> Personal-use build. Streams resolve from YouTube via yt-dlp (ToS risk accepted by
> the owner); sources are pluggable behind the resolver interface.
