"""Offline fixtures for RESOLVER_MOCK=1: demo tracks, streams, charts, WAV tones.

Lets the entire gateway → resolver stack be exercised with zero external
network (sandbox demos, CI, tests). Never active in live mode.
"""

from __future__ import annotations

import hashlib
import math
import os
import struct

from .config import MOCK_PUBLIC_URL
from .normalize import track

VIDEO_IDS = ["mock00000001", "mock00000002", "mock00000003", "mock00000004", "mock00000005", "mock00000006"]

_FIXTURES: list[dict] = [
    dict(video_id="mock00000001", title="Midnight Mirage", artist="Nova Arcade", channel="UCmock0000000A", duration=214, album="Chrome Gardens", art="https://picsum.photos/seed/mirage/512"),
    dict(video_id="mock00000002", title="Paper Crowns", artist="Elder & Vine", channel="UCmock0000000B", duration=187, album="Quiet Riot Season", art="https://picsum.photos/seed/crowns/512"),
    dict(video_id="mock00000003", title="Neon Tide", artist="Kite Society", channel="UCmock0000000C", duration=231, album="Afterglow Club", art="https://picsum.photos/seed/tide/512"),
    dict(video_id="mock00000004", title="Slow Orbit", artist="Marbles in Space", channel="UCmock0000000D", duration=198, album="Zero G Disco", art="https://picsum.photos/seed/orbit/512"),
    dict(video_id="mock00000005", title="Ink & Honey", artist="The Foxglove Union", channel="UCmock0000000E", duration=244, album="Field Notes", art="https://picsum.photos/seed/honey/512"),
    dict(video_id="mock00000006", title="Glasshouse Summer", artist="Nova Arcade", channel="UCmock0000000A", duration=205, album="Chrome Gardens", art="https://picsum.photos/seed/summer/512"),
]

_BY_ID = {f["video_id"]: f for f in _FIXTURES}


def _to_track(f: dict, category: str = "song") -> dict:
    return track(
        video_id=f["video_id"],
        title=f["title"],
        artists=[{"name": f["artist"], "channel_id": f["channel"]}],
        source="ytmusic",
        duration=f["duration"],
        artwork=f["art"],
        album=f["album"],
        popularity=75,
        category=category,
    )


def search(query: str, limit: int = 20) -> dict:
    q = query.lower()
    hits = [
        f
        for f in _FIXTURES
        if q in f["title"].lower()
        or q in f["artist"].lower()
        or q in f["album"].lower()
        or all(tok in (f["title"] + " " + f["artist"]).lower() for tok in q.split())
    ]
    if not hits:
        hits = _FIXTURES  # demo-friendly: empty queries still show the catalogue
    artists = []
    seen = set()
    for f in hits:
        if f["artist"] not in seen:
            seen.add(f["artist"])
            artists.append({"name": f["artist"], "channel_id": f["channel"], "image": f["art"]})
    return {
        "tracks": [_to_track(f) for f in hits[:limit]],
        "artists": artists[:10],
        "albums": [
            {"title": f["album"], "artist": f["artist"], "artwork": f["art"], "id": f"MPRE_{f['video_id']}"}
            for f in hits[:8]
        ],
        "source": "mock",
        "warnings": ["mock_mode"],
    }


def suggestions(query: str, limit: int = 8) -> list[str]:
    q = query.lower()
    out = []
    for f in _FIXTURES:
        for text in (f["title"], f"{f['title']} {f['artist']}"):
            if q in text.lower() and text not in out:
                out.append(text)
    return out[:limit]


def meta(video_id: str) -> dict:
    f = _BY_ID.get(video_id)
    if not f:
        raise KeyError(f"unknown mock track {video_id}")
    return _to_track(f, category="video")


def streams(video_id: str) -> dict:
    if video_id not in _BY_ID:
        raise KeyError(f"unknown mock track {video_id}")
    base = f"{MOCK_PUBLIC_URL}/mock/audio/{video_id}"
    headers = {"User-Agent": "TheMashup-Mock/0.1", "Referer": "https://www.youtube.com/"}
    result = {
        "candidates": [
            {
                "source": "ytdlp",
                "url": f"{base}?fmt=opus",
                "mime": 'audio/webm; codecs="opus"',
                "ext": "webm",
                "quality": "opus 160k",
                "bitrate_kbps": 160,
                "has_video": False,
                "http_headers": headers,
            },
            {
                "source": "ytdlp",
                "url": f"{base}?fmt=m4a",
                "mime": 'audio/mp4; codecs="mp4a.40.2"',
                "ext": "m4a",
                "quality": "m4a 128k",
                "bitrate_kbps": 128,
                "has_video": False,
                "http_headers": headers,
            },
            {
                # Deliberately dead candidate → proves gateway 410 → player failover.
                "source": "ytdlp",
                "url": f"{base}?fmt=dead",
                "mime": "audio/webm",
                "ext": "webm",
                "quality": "broken 64k",
                "bitrate_kbps": 64,
                "has_video": False,
                "http_headers": headers,
            },
        ],
        "related": [f for f in [_to_track(x, "video") for x in _FIXTURES] if f["id"] != video_id],
        "raw": {"mock": True},
    }

    # A small synthetic A/V file is used only in explicit fixture tests.
    if os.getenv("THEMASHUP_FIXTURE_VIDEO") == "1":
        result["candidates"].append({
            "source": "ytdlp", "url": f"{base}?fmt=video", "mime": "video/webm",
            "ext": "webm", "quality": "synthetic video", "has_video": True, "http_headers": headers,
        })
    # Exercise dead-candidate → next-candidate in the actual browser player.
    if os.getenv("THEMASHUP_FIXTURE_DEAD_FIRST") == "1":
        candidates = result["candidates"]
        dead = [c for c in candidates if c.get("quality") == "broken 64k"]
        result["candidates"] = dead + [c for c in candidates if c not in dead]
    return result


def formats(video_id: str) -> dict:
    f = _BY_ID.get(video_id)
    if not f:
        raise KeyError(f"unknown mock track {video_id}")
    return {
        "video_id": video_id,
        "title": f["title"],
        "duration_sec": f["duration"],
        "audio": [
            {"format_id": "mock-opus", "ext": "webm", "quality": "opus 160k", "bitrate_kbps": 160, "has_video": False, "target_container": "opus"},
            {"format_id": "mock-m4a", "ext": "m4a", "quality": "m4a 128k", "bitrate_kbps": 128, "has_video": False, "target_container": "mp3"},
            {"format_id": "mock-transcode", "ext": "mp3", "quality": "mp3 320k (transcode)", "bitrate_kbps": 320, "has_video": False, "target_container": "mp3"},
        ],
        "video": [
            {"format_id": "mock-360", "ext": "mp4", "quality": "360p", "width": 640, "height": 360, "has_video": True, "target_container": "mp4"},
            {"format_id": "mock-720", "ext": "mp4", "quality": "720p", "width": 1280, "height": 720, "has_video": True, "target_container": "mp4"},
            {"format_id": "mock-1080", "ext": "mp4", "quality": "1080p", "width": 1920, "height": 1080, "has_video": True, "target_container": "mp4"},
        ],
    }


def related(video_id: str) -> list[dict]:
    return [_to_track(f, "video") for f in _FIXTURES if f["video_id"] != video_id]


def charts() -> dict:
    return {"tracks": [_to_track(f, "video") for f in _FIXTURES], "source": "mock", "warnings": ["mock_mode"]}


def artist(channel_id: str) -> dict:
    hits = [f for f in _FIXTURES if f["channel"] == channel_id]
    if not hits:
        raise KeyError(f"unknown mock artist {channel_id}")
    return {
        "artist": {"name": hits[0]["artist"], "channel_id": channel_id, "image": hits[0]["art"]},
        "tracks": [_to_track(f) for f in hits],
    }


# ── WAV tone generation (streamable, Range-capable, deterministic per id) ─────

_wav_cache: dict[str, bytes] = {}


def wav(video_id: str, fmt: str = "opus", seconds: int = 30, rate: int = 8000) -> bytes:
    key = f"{video_id}:{fmt}"
    cached = _wav_cache.get(key)
    if cached:
        return cached
    seed = int(hashlib.md5(key.encode()).hexdigest()[:6], 16)
    freq = 180 + seed % 700
    n = seconds * rate
    frames = bytearray(n * 2)
    for i in range(n):
        # Tone with slow tremolo so seeks/progress are audible if played.
        tremolo = 0.55 + 0.45 * math.sin(2 * math.pi * 0.4 * i / rate)
        sample = int(11000 * tremolo * math.sin(2 * math.pi * freq * i / rate))
        struct.pack_into("<h", frames, i * 2, sample)
    data = bytes(frames)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(data), b"WAVE",
        b"fmt ", 16, 1, 1, rate, rate * 2, 2, 16,
        b"data", len(data),
    )
    blob = header + data
    if len(_wav_cache) > 64:
        _wav_cache.clear()
    _wav_cache[key] = blob
    return blob
