# TheMashup — Decisions Log

> Append-only. Every decision that changes the blueprint is recorded here with its reason.
> Phase 0 gate answers are recorded in §1; research-driven amendments in §2.

---

## 1. Gate G0 Answers (2026-11-08)

| ID | Question | Answer | Consequence |
|---|---|---|---|
| G0 | Approve Phase 0? | **Approved** | Phase 1 authorised. |
| Q2 | Licence | **"Choose yourself, best experience + extra features"** | **MIT** for our code; the optional NewPipe-extractor flavour stays an isolated, opt-in, GPL build (ADR-005 preserved). Rationale: maximum reuse and contribution, zero obligations for the default artefacts. |
| Q3 | Browser transport | **Ship 2 default relays, editable** | `TransportPort` ships a ranked, health-checked relay ladder (ADR-001). Native builds bypass it. |
| Q4 | Account scope | **Full write access** | Drive the **cookie/JWT path** (see A-3), not OAuth. Web gets an "advanced paste" path; Android gets a native login WebView. |

**Extra features added at the user's request ("+ some extra features from your side"):**
recorded in `docs/10-BACKLOG.md` — karaoke word-sync lyrics, lyric-corpus warm-up, EQ + crossfade,
sleep timer, "Radio from lyrics", offline-first library, listening stats, share-card generator.

---

## 2. Amendments Discovered During Phase 1 Research

### A-1 — OAuth device-code flow is **not viable**; cookie capture is the real mechanism
**Finding.** Google's installed-app OAuth flow requires a `client_secret` in the token exchange
(`grant_type=http://oauth.net/grant_type/device/1.0`, `client_secret=…`). Shipping a borrowed secret in
a public client is both a secret-leak and a ToS violation. Every Android InnerTube client in production
that has accounts — InnerTune/OuterTune, ViMusic, Metrolist — does **not** use OAuth for this reason.
**Verified source:** `z-huang/InnerTune` → `ui/screens/LoginScreen.kt` captures
`CookieManager.getInstance().getCookie("https://music.youtube.com")` from a WebView pointed at
`accounts.google.com/ServiceLogin?...&continue=…music.youtube.com`, and `InnerTube.kt` then signs every
request with `SAPISIDHASH`.
**Decision.** Authentication = **cookie capture + `SAPISIDHASH` request signing**.
- **Android:** native WebView login, cookies harvested after redirect to `music.youtube.com`, stored in
  Keystore-backed secure storage.
- **Web:** cannot read cross-origin cookies → honest, labelled **advanced path**: user pastes their own
  cookie string once (exactly what `ytmusicapi` power users do), or stays anonymous.
- Consequence: the blueprint's "OuterTune OAuth flow" is replaced, and I am telling you rather than
  claiming to have built it. Browsing alone needs no account at all.

### A-2 — LRCLIB cannot search lyric *text*; the local index is mandatory, not an optimisation
**Finding.** Read `tranxuanthang/lrclib/server/src/search_index/query.rs` and
`routes/search_lyrics.rs` at source. `/api/search` indexes exactly three fields —
`name_lower`, `artist_name_lower`, `album_name_lower` — with AND-over-tokens semantics. There is no
lyric-body full-text endpoint. The `q` parameter matches **titles/artists/albums**, never verse text.
**Decision.** Fuzzy lyric recognition becomes a **local-first** feature with a three-stage ladder:
1. **Local BM25 index** over lyrics already cached on device (fast, offline, private).
2. **Corpus warm-up** (see A-4) so stage 1 is useful on day one.
3. **Upstream text fallback** — `search(query=<lyric phrase>)` on YT Music, which frequently resolves
   lyric phrases through captions/descriptions; results are then re-scored locally by title-token overlap.
Also confirmed from source: `/api/search` returns `hasWordSync` and `/api/get` returns `syncedLyrics` +
`lyricsfile` → **karaoke-grade timing is available**, and CORS is `allow_origin: Any`.

### A-3 — Client-profile strings are the #1 breakage vector; they must be hot-swappable
**Finding.** `yt-dlp`'s `INNERTUBE_CLIENTS` (700+ line table) pins `clientVersion` per client and is
patched constantly; `WEB` is currently `2.20260708.00.00`, `WEB_REMIX` `1.20260707.12.00`,
`ANDROID` `21.26.364`, `IOS` `21.26.4`. InnerTune's baked `WEB_REMIX 1.20220606.03.00` is years stale.
**Decision.** The profile table is **data, not code**: a bundled JSON (`compat/profiles.json`) +
optional remote refresh from a static, free URL + user-editable override in Settings → Advanced. No
server, no app update needed when YouTube bumps a version.

### A-4 — PoToken reality check (drives the resolution ladder)
**Finding (verified in yt-dlp source).**

| Client | GVS HTTPS PoToken | Notes |
|---|---|---|
| `WEB`, `MWEB`, `WEB_REMIX`, `WEB_CREATOR` | **required** (not required if Premium) | BotGuard token needed |
| `ANDROID`, `IOS`, `ANDROID_VR` | required, *unless* a player token is supplied | |
| **`TVHTML5`** | **none declared** | still works today |
| **`VISIONOS`** | **none declared** — and returns **cipher-free** URLs | visionOS 1.02, no JS player needed |
| `TVHTML5_SIMPLY` | required | |

**Decision.** Resolution ladder = `VISIONOS → TVHTML5 → ANDROID → IOS → WEB_REMIX → native extractor →
relay`. Browser mode cannot run `n-sig` JS cheaply or mint BotGuard tokens, so it leans on the
PoToken-free clients. This is the crux of the whole serverless design, and it is why the ladder is
ordered by *freedom from tokens*, not by speed.

### A-5 — `signatureTimestamp` must come from the player JS, not a date hack
**Finding.** `ytmusicapi` sends `signatureTimestamp = days_since_epoch - 1` as a placeholder and openly
warns it "might result in invalid streaming URLs".
**Decision.** Extract `signatureTimestamp` from the real player script (cached 24 h), with the
PoToken-free clients generally not needing the JS transform at all. Keep the date hack only as a
last-resort fallback behind a flag.

---

## 3. Standing Rules Adopted

- Every upstream response is parsed through a Zod schema; unknown fields are dropped, never trusted.
- No `client_secret`, signing key, or account credential is ever committed. CI greps for them.
- Any behaviour that cannot be verified in this sandbox is labelled **UNVERIFIED** in the docs and is
  covered by the in-app Diagnostics probe so *you* can verify it on real hardware in one tap.
