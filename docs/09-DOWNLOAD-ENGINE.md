# TheMashup — Download Engine & Media Pipeline

> **Phase 1 deliverable — Document 9 of 10**
> The user asked for "MP3/FLAC/M4A across all bitrates and MP4 360p→4K". This document states precisely
> what is possible per platform, and how it is done without a server.

---

## 1. The Honest Capability Matrix

| Target | Web (browser) | Android | Windows (Phase 4) |
|---|---|---|---|
| **M4A / AAC** 48/128 kbps | stream copy | stream copy | stream copy |
| **M4A / AAC 256** (itag 141) | copy if the account is Premium, else shown locked | same | same |
| **WEBM / Opus** 50/70/~160 | stream copy | stream copy | stream copy |
| **MP3** 128/192/256/320 | transcode in `ffmpeg.wasm` (**single-thread core**) | transcode via **FFmpegKit** | native ffmpeg |
| **FLAC** | encode via **libflac.js**, or ffmpeg.wasm if the build has the encoder | FFmpegKit | native ffmpeg |
| **MP4** 144p→1080p | **remux** with `mp4box.js` / `mux.js` (no re-encode) | **remux** with `MediaMuxer` | native ffmpeg |
| **MP4 1440p/2160p** | remux VP9→MP4 **is not valid**; offer WebM/MKV instead | remux to MKV, or transcode (slow) on capable devices | native ffmpeg |
| **MP3/Opus from a video-only track** | full transcode | FFmpegKit | native |
| No network at all | ✅ (all local) | ✅ | ✅ |

**Two hard truths, stated in the UI, not buried:**
1. **FLAC never improves fidelity.** The source is at best 256 kbps AAC or ~160 kbps Opus. FLAC is a
   lossless *container for a lossy source*. The download card says so in one line.
2. **4K H.264 doesn't exist.** 1440p/2160p are VP9/AV1 only. Offering "MP4 4K" would mean a slow,
   pointless transcode; we offer WebM/MKV 4K instead and label it accurately.

## 2. Why Not Just Use ffmpeg.wasm for Everything
- The **multi-threaded** core needs `SharedArrayBuffer`, i.e. `COOP: same-origin` + `COEP: require-corp`.
  Those headers **break the CORS relay chain** that browser playback depends on (ADR-001) and would
  also break any embedded third-party asset. Enabling them to make downloads 2× faster would kill
  playback entirely — an unacceptable trade.
- So the web build uses the **single-threaded core** (no isolation headers needed) **and only for audio
  transcode**. Video is **remuxed** in pure JS (`mp4box.js`), which is ~50× faster and needs no wasm.
- Reported mobile reliability of ffmpeg.wasm is poor → on Android we never use it; we use native
  `MediaMuxer` + FFmpegKit.

## 3. Job State Machine

```
        ┌──────────┐  resolve   ┌───────────┐  head ok   ┌─────────────┐
  create│  QUEUED  ├───────────►│ RESOLVING ├───────────►│ DOWNLOADING │
        └──────────┘            └─────┬─────┘            └──┬───┬──────┘
                                      │ fail                 │   │ range fail
                                      ▼                      │   ▼
                                 ┌────────┐                  │ ┌──────────┐
                                 │ FAILED │◄─────────────────┘ │ RETRYING │
                                 └────┬───┘   (4 attempts)     └────┬─────┘
                                      │ user retry                  │
                                      ▼                             │
                                 ┌────────┐   bytes complete        │
                                 │ MUXXING│◄────────────────────────┘
                                 └───┬────┘
                            ┌────────┴─────────┐
                            ▼                  ▼
                      ┌──────────┐      ┌────────────┐
                      │ COMPLETE │      │ PARTIAL    │  (resumable, keeps bytes)
                      └──────────┘      └────────────┘
```

- Persisted in IndexedDB on every transition → an app kill resumes exactly where it stopped.
- Max **2 concurrent jobs** (3 when charging + unmetered); downloader is a token bucket so it never
  starves playback.

## 4. Transport Plan

```
HEAD/GET → 200/206?
 ├─ accept-ranges: bytes + content-length known
 │    → split into min(4, ceil(size/4MB)) ranges → parallel fetch with per-chunk retry
 │    → each chunk streams into OPFS scratch file at its offset (no RAM spike)
 │    → verify total size + (optionally) content-length
 └─ no ranges
      → single streamed Response.body reader, resume via `Range: bytes=N-` when supported
         (many googlevideo hosts accept it even when HEAD omits the header — probe once)
```
- `expire` in the URL ≈ 6 h → a job started and paused for longer re-resolves automatically before
  resuming (silent, logged to diagnostics).
- Throttling/429 → exponential backoff with jitter, and the job yields to any playing stream.

## 5. Output Paths & Naming

```
Android:  /storage/emulated/0/Music/TheMashup/{Artist}/{Album}/{NN} - {Title} [{quality}].{ext}
          (or user-picked SAF tree; MediaStore registration so other apps see it)
Web:      OPFS /downloads/…  + "Save to device" via File System Access API (fallback: download attr)
Windows:  %USERPROFILE%\Music\TheMashup\…  (Phase 4)
```
Filename sanitizer: strip `\/:*?"<>|`, collapse whitespace, cap at 180 chars, NFC, collision suffix ` (2)`.
An optional `.m3u8` playlist export per album is written on request.

## 6. Metadata & Artwork
- ID3v2.4 (MP3), MP4 `ilst` atoms (`©nam/©ART/©alb/trkn/disk/covr`) for M4A/MP4, Vorbis comments for
  FLAC/Opus/WebM, Matroska tags for MKV — written by our own tiny JS taggers (no dependency) or by
  FFmpegKit's `-metadata` flags where a transcode already happens.
- Cover art embedded at up to 1000×1000 (YouTube's `=w1000` variant), plus a `cover.jpg` beside the file
  when the user enables "folder artwork".
- Optional `.lrc` sidecar written from LRCLIB when available (and `word-sync` → enhanced LRC).

## 7. Batch UX
Select 40 tracks from a playlist → "Download all" → a single sheet showing the *combined* size estimate,
the chosen target, and per-track progress. Because the plan re-resolves each track lazily, the estimate
is marked `±` until resolution completes.

## 8. Test Matrix (Phase 2 gate)
| Case | Expected |
|---|---|
| Airplane mode mid-download | job → `PARTIAL`, auto-resumes on reconnect |
| App force-killed at 60 % | resumes at 60 %, no duplicate bytes |
| URL expires while paused | silent re-resolve, continues |
| 4K request on a VP9-only track | offers WebM/MKV, explains, never produces a broken MP4 |
| Disk full | `Storage quota` error with exact MB needed, keeps existing files intact |
| Relay dies mid-download | retries next relay, job survives |
| Corrupt byte length | one retry, then `PARTIAL` with a Resume button |
