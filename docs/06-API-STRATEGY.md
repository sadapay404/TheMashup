# TheMashup — API Strategy & Extraction Map

> **Phase 1 deliverable — Document 6 of 10**
> Everything here was read from upstream source (yt-dlp `INNERTUBE_CLIENTS`, InnerTune `InnerTube.kt`,
> ytmusicapi `1.12.3`, LRCLIB `server/`). Items that could not be executed in this sandbox are marked
> **[UNVERIFIED-LIVE]** — a one-tap Diagnostics probe exists for each (see `08`).

---

## 1. Endpoint Catalogue

Base: `https://music.youtube.com/youtubei/v1/` · query: `?alt=json&prettyPrint=false&key=<client key>`

| # | Endpoint | Method | Purpose | Auth |
|---|---|---|---|---|
| E1 | `search` | POST | music search, 9 filter types, continuation | optional |
| E2 | `music/get_search_suggestions` | POST | type-ahead suggestions (body `{input}`) | optional |
| E3 | `browse` | POST | home, artist, album, playlist, library, lyrics (`MPLYt…`) | optional |
| E4 | `next` | POST | watch/queue panel — **the radio engine** (`RDAMVM<videoId>`) | optional |
| E5 | `player` | POST | streaming formats (the download core) | optional |
| E6 | `guide` | POST | navigation tree / library shortcuts | optional |
| E7 | `account/account_menu` | POST | display name, email, channel handle | **required** |
| E8 | `like/like`, `like/dislike`, `like/removelike` | POST | ratings (write access) | **required** |
| E9 | `playlist/create`, `playlist/edit`, `browse/edit_playlist` | POST | playlist writes | **required** |
| E10 | `subscription/subscribe`, `unsubscribe` | POST | artist follows | **required** |
| E11 | `feedback` | POST | track feedback (used for "less like this") | **required** |
| E12 | LRCLIB `GET /api/get`, `/api/search`, `/api/get/{id}` | GET | lyrics (CORS `*`, no key) | none |

### 1.1 Anatomy of a request

```http
POST /youtubei/v1/search?alt=json&prettyPrint=false&key=<profile.apiKey>
Content-Type: application/json
X-YouTube-Client-Name: 67              # WEB_REMIX
X-YouTube-Client-Version: 1.20260707.12.00
x-origin: https://music.youtube.com
Referer: https://music.youtube.com/
X-Goog-Visitor-Id: <visitorData>       # session-stable, required for consistency
Cookie: <captured cookie>              # only when signed in
Authorization: SAPISIDHASH <ts>_<sha1("<ts> <SAPISID> https://music.youtube.com")>
```

Body shape is uniform:

```jsonc
{
  "context": {
    "client": {
      "clientName": "WEB_REMIX",
      "clientVersion": "1.20260707.12.00",
      "hl": "en", "gl": "PK",
      "visitorData": "<…>",
      "userAgent": "<matching UA>",
      "osName": "Android", "osVersion": "11",   // android profiles only
      "androidSdkVersion": 30                     // android profiles only
    },
    "user": { "lockedSafetyMode": false },
    "request": { "useSsl": true }
  },
  "query": "…",          // E1
  "params": "…",         // filter/scope protobuf (base64)
  "continuation": "…", "ctoken": "…"
}
```

---

## 2. Client Profile Matrix (data-driven — see Amendment A-3)

| Profile | clientName | Version (2026-11) | Needs PoToken | Cipher needed | Music catalogue |
|---|---|---|---|---|---|
| **VISIONOS** | `VISIONOS` | `1.02` | **No** | **No** (direct URLs) | yes (video catalogue, covers music) |
| **TVHTML5** | `TVHTML5` | `7.20260707.07.00` | **No** | No | yes |
| ANDROID | `ANDROID` | `21.26.364` | yes* | No | yes |
| IOS | `IOS` | `21.26.4` | yes* | No | yes |
| **WEB_REMIX** | `WEB_REMIX` | `1.20260707.12.00` | **yes** (no if Premium) | sometimes | **best** (YTM-only) |
| TVHTML5_SIMPLY | `TVHTML5_SIMPLY` | `1.0` | yes | No | yes |

`*` not required if a player token is supplied. `WEB_REMIX` gives the richest YTM metadata but is the
most token-hostile for streaming — so we **split the roles**:

> **Metadata via `WEB_REMIX`. Streams via `VISIONOS`/`TVHTML5`. Library writes via `ANDROID_PLAYER`/cookie.**

This split is the single most important architectural decision in Phase 1.

---

## 3. Search

### 3.1 Filter parameters (verified in ytmusicapi `parsers/search.py`)

| Filter | `params` value |
|---|---|
| songs | `EgWKAQIIAWoKEAUQCRADEAoYBA%3D%3D` |
| videos | `EgWKAQIQIIAWoKEAUQCRADEAoYBA%3D%3D` |
| albums | `EgWKAQIYAWoKEAUQCRADEAoYBA%3D%3D` |
| artists | `EgWKAQIgAWoKEAUQCRADEAoYBA%3D%3D` |
| playlists | `EgWKAQIoAWoKEAUQCRADEAoYBA%3D%3D` |
| episodes | `EgWKAQJIAWoMEAQIEFABGAAoATgBQAFIAg%3D%3D` |
| podcasts | `EgWKAQJQAWoMEAQIEFABGAAoATgBQAFIAg%3D%3D` |
| (scope) uploads | `agIYAw%3D%3D` |
| (scope) library | `agIYBA%3D%3D` |

Note the `AWoKEAUQCRADEAoYBA` tail = sort/spelling block; `ignore_spelling` variant
`AUICCAFqDBAOEAoQAxAEEAkQBQ%3D%3D`.

### 3.2 Response → domain mapping (the parse contract)

| Renderer | Domain object |
|---|---|
| `musicResponsiveListItemRenderer` | `Track \| Album \| Artist \| Playlist` (discriminated by `musicItemRendererDisplayPolicy` + navigation endpoint) |
| `musicTwoRowItemRenderer` | `Album \| Playlist \| Video` |
| `musicCardShelfRenderer` | "Top result" hero |
| `musicShelfRenderer.contents[]` | grouped result section |
| `musicShelfContinuation` / `nextContinuationData` | pagination token |

---

## 4. Lyrics Pipeline (revised per Amendment A-2)

```
            ┌──────────────── user types 14 words of a lyric ───────────────┐
            ▼                                                              │
   [1] normalize  NFC · lowercase · strip punct/diacritics · collapse ws    │
            ▼                                                              │
   [2] tokenize → stop-words → stems (Porter, bundled)                      │
            ▼                                                              │
   [3] LOCAL BM25  (MiniSearch over cached lyric docs)  ──── hits? ────────┤
            │ no                                                          │
            ▼                                                              │
   [4] CORPUS WARM-UP LOOKUP (prebuilt local lyric shards + listened set)  │
            │ no                                                          │
            ▼                                                              │
   [5] UPSTREAM TEXT FALLBACK: search(q = phrase) → re-score titles        │
            │ no                                                          │
            ▼                                                              │
   [6] LRCLIB metadata search using detected "title - artist" pattern      │
            ▼                                                              │
   result set → rank fusion (RRF, k=60) → top 8 → hydrate art/duration ────┘
```

**Scoring fusion.** Reciprocal-rank fusion across the stage outputs prevents any single weak signal
from dominating: `score(d) = Σ_i 1/(60 + rank_i(d))`.

**Known-good contract.** `GET /api/get?track_name=&artist_name=&duration=` → `{plainLyrics,
syncedLyrics, hasWordSync, instrumental}`; `GET /api/search?q=` → title/artist/album matches only.
Both `Access-Control-Allow-Origin: *`.

**Karaoke mode.** Parse `syncedLyrics` LRC `[mm:ss.xx]`, support `[offset:+/-ms]` and multi-timestamp
lines, interpolate per-word timing from `lyricsfile`/`hasWordSync` where available, otherwise
progressive line highlight with a 120 ms lookahead.

---

## 5. Radio / Recommendation Surface

| Signal | Endpoint | Payload |
|---|---|---|
| Track radio | `next` | `{videoId, playlistId: "RDAMVM"+id, isAudioOnly: true, tunerSettingValue: "AUTOMIX_SETTING_NORMAL", enablePersistentPlaylistPanel: true}` |
| Artist radio | `browse` | `{browseId: "UC…", params: radio}` / `radioId: "RDEM…"` |
| Home shelves | `browse` | `{browseId: "FEmusic_home"}` |
| Related | `browse` | `related` browseId from `next` |
| Lyrics browseId | `next` | `lyrics: "MPLYt…"` |

`next` returns `playlistPanelVideoRenderer[]` — up to 25 algorithmically chosen tracks. That is the
upstream radio we re-rank locally (see `07-RECOMMENDATIONS.md`).

---

## 6. Streaming & Downloads

### 6.1 Format ladder — audio (verified itags)

| itag | Container | Codec | Nominal bitrate | Availability | Use |
|---|---|---|---|---|---|
| 139 | m4a | AAC HE v1 | 48 kbps | rare | "Data saver" |
| 140 | m4a | AAC LC | 128 kbps | **always** | default |
| **141** | m4a | AAC LC | **256 kbps** | Premium / YTM | **best lossy-compatible** |
| 249 | webm | Opus | ~50 kbps VBR | common | data saver |
| 250 | webm | Opus | ~70 kbps VBR | common | |
| **251** | webm | Opus | **~160 kbps VBR** | **common — best free** | default best |
| 256 | m4a | AAC HE v1 | 192 kbps | rare (5.1) | |
| 258 | m4a | AAC LC | 384 kbps | rare (5.1) | |

### 6.2 Format ladder — video

| itag | Resolution | Codec | Container |
|---|---|---|---|
| 160 | 144p | H.264 | mp4 |
| 133/242 | 240p | H.264/VP9 | mp4/webm |
| 134/243 | 360p | H.264/VP9 | mp4/webm |
| 135/244 | 480p | H.264/VP9 | mp4/webm |
| 136/247 | 720p | H.264/VP9 | mp4/webm |
| 137/248 | 1080p | H.264/VP9 | mp4/webm |
| 271/308 | 1440p | VP9 | webm |
| 313 | 2160p (4K) | VP9 | webm |
| 401 | 2160p (4K) | AV1 | mp4 |
| 18 | 360p | progressive H.264+AAC | mp4 (audio+video in one) |

### 6.3 Container/target truth table (what the UI may promise)

| User picks | Source | Work done | Honest label |
|---|---|---|---|
| M4A 128k | itag 140 | **direct stream copy** | "Original AAC 128" |
| M4A 256k | itag 141 | direct stream copy, may be locked | "Original AAC 256 (Premium)" |
| WEBM/Opus | itag 251/250/249 | direct stream copy | "Original Opus ~160" |
| MP3 | itag 251/140 | transcode (ffmpeg.wasm / FFmpegKit) | "MP3 320k (transcoded)" |
| FLAC | itag 251/140 | **decode + lossless re-encode** | "FLAC (lossless container, from lossy source)" |
| MP4 1080p | 137 + 140 | **remux** (no re-encode, fast) | "MP4 1080p" |
| MP4 360p | 18 | direct copy | "MP4 360p" |
| MKV/WebM 4K | 313 + 251 | remux | "WebM 2160p" |

### 6.4 Signed URL lifecycle
`streamingData.expiresInSeconds ≈ 21540` (≈6 h); URLs are bound to the requesting client profile, IP
and `visitorData`. → **never persist URLs**; persist `{videoId, itag, profile}` and re-resolve on play
or resume. Range requests are supported (`accept-ranges: bytes`), enabling 4-way chunked downloads.

---

## 7. Client Profile / Signature Strategy (the ladder)

```
resolveStream(videoId)
 ├─ 1. VISIONOS     → if streamingData.formats[].url present → done (no cipher, no PoToken)
 ├─ 2. TVHTML5      → same check
 ├─ 3. ANDROID      → may return signatureCipher → needs n-sig
 ├─ 4. IOS          → same
 ├─ 5. WEB_REMIX    → needs PoToken; if account is Premium, allowed without
 ├─ 6. NativeExtractorPort (Android only, opt-in flavour)
 └─ 7. RelayLadder  → equivalent response via public instance
```

**n-sig / signature handling (browser).** Deobfuscating YouTube's player JS is a moving target. Policy:
(a) avoid it by preferring PoToken-free clients; (b) if unavoidable, run the extracted transform inside
a **sandboxed Worker** with a 250 ms budget and a hard kill, using a *regex-anchored* extractor (not a
full JS parser) — and if it fails, degrade to another rung. **Never** ship an eval of untrusted code in
the main thread.

---

## 8. Authentication Contract (Amendments A-1)

| Platform | Mechanism | Storage |
|---|---|---|
| Android | WebView → `accounts.google.com/ServiceLogin?ltmpl=music&continue=…music.youtube.com`; harvest cookie + `yt.config_.VISITOR_DATA` on redirect | Keystore-encrypted store |
| Web | Manual cookie paste (advanced) or anonymous | non-extractable AES-GCM in IDB |
| All | `Authorization: SAPISIDHASH <ts>_<sha1(ts + " " + SAPISID + " " + origin)>` per request | derived per call, never stored |

Cookie keys used: `SAPISID` (hash source), `__Secure-3PAPISID` (alt), `SID`, `HSID`, `SSID`, `APISID`.
Write endpoints (E7–E11) require this cookie path; **anonymous users keep the whole read/play/download surface**.

---

## 9. Upstream Drift Defence

| Defence | Implementation |
|---|---|
| Profile strings rot | JSON data file + remote refresh + user override (A-3) |
| Renderer renames | `parse/` uses "first matching renderer of N known names" + graceful skip |
| Field moves | Zod `.catch()`/optional + compat map `{oldField → newField}` |
| Endpoint 400s | circuit breaker per endpoint (5 fails / 60 s → open 5 min) |
| Quota / 429 | exponential backoff + jitter, per-endpoint token bucket |
| Total failure | cached library + downloads remain fully usable (offline-first) |
