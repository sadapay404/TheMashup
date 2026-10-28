# TheMashup API Reference (Phase 2)

Gateway: `http://localhost:4000/api/...` · Resolver (internal): `http://127.0.0.1:8000`
Web dev server (Phase 3) proxies `/api` → gateway, so the browser always uses **relative URLs**.

> **Dev modes:** `RESOLVER_MOCK=1` (resolver fixtures + local WAV tones) and
> `MOCK_UPSTREAM=1` (gateway lyrics fixtures) let everything run with zero external
> network. Omit both for live YouTube/Piped/Invidious/LRCLIB on your machine.

## Source priority

| Purpose | 1st | 2nd | 3rd |
|---|---|---|---|
| Streams | **yt-dlp direct** | Piped mirrors | Invidious mirrors |
| Search/metadata | **ytmusicapi** | Piped | Invidious |
| Related | Piped `relatedStreams` | Invidious | ytmusic same-artist |
| Lyrics | **LRCLIB** (`/api/search`, `/api/get`) | — | — |

Failures degrade with `warnings[]` + `degraded: true`; full exhaustion → structured
`502 {error:{code,message,detail}}`. Rate limits: 90/min search, 40/min streams, 300/min other.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Gateway + resolver + lyrics provider status |
| `GET /api/search?q=&type=auto\|tracks\|videos\|albums\|artists&limit=` | Metadata search |
| `GET /api/search/suggest?q=&limit=` | Autocomplete strings |
| `GET /api/lyrics/match?q=` | **Hybrid search**: free text / partial lyrics → ranked track+lyrics candidates (`similarity` 0–1) |
| `GET /api/lyrics/:trackId` | Full lyrics: `{plain, synced:[{time,text}], provider}` |
| `POST /api/streams` body `{video_id}` | Ordered playable candidates with proxy tokens |
| `GET /api/stream/:token` | **Same-origin Range proxy** (audio playback URL) |
| `GET /api/track/:trackId` | Rich metadata + `related[]` |
| `GET /api/related/:trackId` | Radio seeds |
| `GET /api/artist/:channelId` | Artist + top songs |
| `POST /api/radio` body `{seed_video_id \| query, limit?}` | Diversified endless queue |
| `GET /api/recommendations?kind=quick\|discover\|trending\|listen_again` | Shelves. `listen_again` **requires identity** (401 otherwise); `discover` is personalized when identified, charts-radio fallback otherwise |
| `POST /api/events` / `GET /api/events/recent` | Listening events (`play/skip/complete/repeat/like/dislike`, optional `listened_ms`; persisted to per-user history when identified) |
| `GET /api/formats/:trackId` | Download format manifest for the quality picker |
| `POST /api/downloads` body `{video_id, container, quality, title?}` | **201** start a download job (identity required) |
| `GET /api/downloads` | Owner-filtered job list |
| `GET /api/downloads/:id` | One job |
| `DELETE /api/downloads/:id` | Cancel (owner-only) |
| `GET /api/downloads/stream` | **SSE** live job snapshots (identity via headers → use fetch streaming, not EventSource) |
| `GET /api/downloads/:id/file` | Stream finished file (`Content-Disposition: attachment`) |

## Playing a track (Phase 3 recipe)

```js
// 1. Resolve candidates (ordered: yt-dlp first, fallbacks after)
const res = await fetch("/api/streams", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ video_id: trackId }),
});
const { candidates } = await res.json();

// 2. Play through the gateway proxy — never the raw upstream URL
const audio = new Audio(candidates[0].play_url); // Range/seek supported (206)
audio.play();

// 3. On error/403 → move to candidates[1], restore audio.currentTime, continue.
//    The proxy answers 410 {code:"CANDIDATE_DEAD"} when an upstream URL dies.
```

`candidates[i]` also carries `url` (raw upstream, for native shells), `http_headers`,
`mime`, `bitrate_kbps`, `expires_at`, `quality`.

## Smart search bar (Phase 3 recipe)

```js
// Fan out in parallel, merge with rankSearchResults() from @themashup/shared
const [meta, lyrics] = await Promise.all([
  fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()),
  fetch(`/api/lyrics/match?q=${encodeURIComponent(q)}`).then(r => r.json()),
]);
// lyrics.matches[] → resolve to tracks via title/artist, tag rows with matched snippet
```

## Radio

```js
POST /api/radio  { "seed_video_id": "dQw4w9WgXcQ", "limit": 30 }
→ { seed, tracks: Track[], mode: "seed", generated_at }
```
Queue is built by `buildRadioQueue()` (shared): dedupe → MMR relevance/diversity →
no adjacent same-artist unless forced.

## Downloads (Phase 5)

Quality matrix (gateway + resolver both enforce it):

| container | qualities |
|---|---|
| `mp3` | `128k`, `320k` |
| `flac` | `best` |
| `opus` | `best` |
| `mp4` | `360p`, `720p`, `1080p`, `4k` |

Job lifecycle: `queued → downloading (progress, speed_bps, eta_s) → processing → completed | failed`.
Identity: header form (`x-dev-user` / `Authorization`) on the JSON routes; the file route and SSE
also accept query form (`?dev_user=` / `?access_token=`) for `<a download>` links and fetch-streaming.
Metadata persists as `jobs/<id>.json` — jobs survive resolver restarts (in-flight jobs reconcile to
`failed: interrupted by restart`). Transcoding uses system ffmpeg with the bundled static binary
(imageio-ffmpeg) as fallback; health reports `resolver.ffmpeg`.

```bash
# start a job → poll → fetch (demo identity)
curl -H "x-dev-user: you-1234" -H "content-type: application/json" \
  -d '{"video_id":"…","container":"mp3","quality":"320k"}' localhost:4000/api/downloads
curl "localhost:4000/api/downloads/:id/file?dev_user=you-1234" -o song.mp3
```

## Error shape (uniform)

```json
{ "error": { "code": "VALIDATION_ERROR | UPSTREAM_ERROR | UNAVAILABLE | RATE_LIMITED | NOT_FOUND | …",
             "message": "human text", "detail": {} } }
```

## Running

```bash
pnpm setup          # once: installs JS workspace + resolver venv
pnpm dev            # resolver :8000 + gateway :4000 together
pnpm test           # 45 tests (shared 12, api 17, resolver 16)
pnpm typecheck      # tsc across workspace
```
