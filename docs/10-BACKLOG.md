# TheMashup — Feature Backlog (v1 + extras)

> **Phase 1 deliverable — Document 10 of 10**
> The user asked me to add my own ideas on top of the brief. Those are marked **[EXTRA]**.
> Every item has an effort estimate and a phase, so nothing here is wishful thinking.

---

## 1. From the Brief (must-have for v1)

| # | Feature | Phase | Effort |
|---|---|---|---|
| 1 | Custom animated UI shell, tokens, glass, springs | 2 | L |
| 2 | Search: songs / artists / albums / playlists, filters, suggestions | 2 | M |
| 3 | Fuzzy **lyric search** (local BM25 + warm-up + fallbacks) | 2 | L |
| 4 | Google sign-in (WebView cookie capture) + library sync | 2 (web: advanced) / 3 (native) | M |
| 5 | Player: queue, shuffle, repeat, seek, speed, Media Session | 2 | L |
| 6 | Download manager: audio (M4A/WEBM/MP3/FLAC) + video (MP4/WebM), queues | 2/3 | XL |
| 7 | On-device recommendation engine | 2 | M |
| 8 | Error boundaries, safe mode, diagnostics probe | 2 | M |
| 9 | Android shell: background audio, lockscreen, notifications | 3 | L |
| 10 | Release APK (signed, R8, baseline profile) | 3 | M |

## 2. My Additions **[EXTRA]**

| # | Feature | Why it matters | Phase | Effort |
|---|---|---|---|---|
| E1 | **Karaoke / word-sync lyrics** with a karaoke view and line-tap seek | LRCLIB exposes `hasWordSync`; almost no free client uses it well. Huge wow factor. | 2 | M |
| E2 | **Lyric Corpus Warm-up** — build a local lyric index from your library in the background (opt-in, resumable, shows progress) | Makes feature #3 useful on day one instead of after a month. | 2 | S |
| E3 | **"Radio from these lyrics"** — any lyric phrase becomes a seed for an instant mix | Turns a lookup into discovery; nothing else does this. | 2 | S |
| E4 | **Audio-reactive player background** (Web Audio analyser → canvas, 60 fps, off by default) | Pure delight, zero cost to the queue. | 2 | S |
| E5 | **Gapless + crossfade** (2–12 s) honoring album continuity | Music-player-grade polish; the AudioContext graph is already there. | 2 | M |
| E6 | **10-band EQ + presets** (`BiquadFilterNode` chain) | Standard on every serious player; trivial with our audio graph. | 2/3 | S |
| E7 | **Sleep timer** with fade-out and "after N tracks" | Most-requested feature in every music app. | 2 | XS |
| E8 | **Offline-first library** — instant cold start, works with zero network | Directly serves the "zero server" promise. | 2 | M |
| E9 | **Listening stats** (top artists, minutes, streaks) — purely local | Personal, private, shareable as an image. | 2 | S |
| E10 | **Share card generator** — album art + lyric quote + palette-matched gradient, exported as a PNG | Organic growth without a server. | 2 | S |
| E11 | **Smart downloads** — "keep my 20 most-played downloaded" auto-rule | Turns the downloader into a real feature, not a manual tool. | 3 | M |
| E12 | **Storage dashboard** with per-tier breakdown and one-tap reclaim | Kills the "why is this 3 GB" problem before it's asked. | 2 | S |
| E13 | **Gesture suite**: swipe queue rows, pull-to-refresh spring, drag-to-reorder queue, long-press radial menu | The "butter-smooth" brief, made concrete. | 2 | M |
| E14 | **Haptics map** (selection / impact / success) tuned per interaction | Feels native on Android; costs nothing on web (`navigator.vibrate` fallback). | 3 | XS |
| E15 | **"Why this track?"** explainable recommendations | Trust + a genuinely novel feature. | 2 | S |
| E16 | **Bluetooth/headphone-connect auto-resume** | Media Session + Intent filters; expected by users. | 3 | S |
| E17 | **Per-OEM battery guidance screen** (Xiaomi/Oppo/Samsung) | Foreground services get killed by aggressive OEMs; this is the #1 cause of "audio stopped". | 3 | XS |
| E18 | **Duplicate detector** in Library (same videoId, or same title+artist+duration) | Real-world libraries get messy fast. | 2 | S |
| E19 | **Export/import local data** (JSON) — playlists, downloads index, affinity graph | Portability and a manual backup path; also the ultimate recovery from a wiped browser. | 2 | S |
| E20 | **Diagnostics probe** — one tap runs every live endpoint check and prints a pass/fail table | Turns my **[UNVERIFIED-LIVE]** claims into something the user can confirm in 3 seconds. | 2 | S |
| E21 | **Theme engine**: art-derived palettes + 6 curated presets + AMOLED black | Identity. | 2 | S |
| E22 | **Podcast-free mode** (hide non-music results) + "music videos only / songs only" toggle | Keeps the library feeling like a music app. | 2 | XS |
| E23 | **Smart resume** ("continue the album you were on") | Small, delightful, zero cost. | 2 | XS |
| E24 | **Searchable download history** with re-download | Users lose files; let them find them again. | 2 | S |

## 3. Explicitly Deferred / Rejected

| Item | Why not |
|---|---|
| Cloud sync of playlists | Requires a server (violates C1). Export/import covers portability (E19). |
| Lyrics from Genius/AZLyrics scraping | ToS violation, brittle, needs a proxy. LRCLIB + local index is enough. |
| SponsorBlock | Not meaningful for music; adds a network dependency. Revisit for long-form. |
| Video playback UI (watch full videos) | Out of scope for a music client; audio-first. |
| Lossless "true HD" marketing | The source isn't lossless. We don't lie (see 09 §1). |
| Social features, comments | Needs accounts + moderation + a server. |
| Windows/macOS/Linux packaging | Phase 4, deliberately deferred by the user. |

## 4. Sequencing Inside Each Phase

Phase 2 order (each step is demoable and previewable):
`tokens+shell → routing+transitions → search (metadata) → player+queue → lyrics (E1/E2/E3) → downloads
(copy + remux) → downloads (transcode) → auth → recommender → offline/persistence → error/safe-mode →
polish pass (E4/E5/E6/E13/E21) → performance pass → soak test`.

Phase 3 order: `Capacitor shell → Media3 service → notification/lockscreen → native downloads+SAF →
touch layouts+haptics (E14/E16/E17) → release build`.
