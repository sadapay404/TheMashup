"""Direct YouTube extraction via yt-dlp — PRIMARY stream/meta source."""

from __future__ import annotations

import re
from typing import Any

from ..config import REQUEST_TIMEOUT
from ..normalize import expires_iso, track

_WATCH_RE = re.compile(r"(?:v=|youtu\.be/)([\w-]{11})")


def _ydl_opts() -> dict[str, Any]:
    return {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": REQUEST_TIMEOUT,
        "retries": 1,
    }


def extract(video_id: str) -> dict[str, Any]:
    import yt_dlp

    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(_ydl_opts()) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("_type") == "playlist" and info.get("entries"):
        info = info["entries"][0]
    return info


def _is_audio(fmt: dict) -> bool:
    acodec = fmt.get("acodec")
    return bool(acodec) and acodec != "none"


def _is_video(fmt: dict) -> bool:
    vcodec = fmt.get("vcodec")
    return bool(vcodec) and vcodec != "none"


def stream_candidates(video_id: str) -> list[dict[str, Any]]:
    """Fresh audio and *progressive* video candidates, best first.

    YouTube often serves video and audio separately; those video-only URLs
    cannot be played with sound on their own and are deliberately excluded.
    The gateway requests a mode and will fall back to other providers if a
    progressive video is unavailable. Never retain signed URLs forever.
    """
    info = extract(video_id)
    formats = [f for f in info.get("formats", []) if _is_audio(f) and f.get("url")]
    audio = [f for f in formats if not _is_video(f)]
    video = [f for f in formats if _is_video(f)]
    audio.sort(key=lambda f: (f.get("abr") or 0, f.get("tbr") or 0), reverse=True)
    video.sort(key=lambda f: (f.get("height") or 0, f.get("tbr") or 0), reverse=True)

    def convert(fmt: dict[str, Any]) -> dict[str, Any]:
        ext = str(fmt.get("ext") or "bin")
        url = str(fmt["url"])
        has_video = _is_video(fmt)
        acodec = fmt.get("acodec") or ext
        abr = fmt.get("abr")
        size = fmt.get("filesize") or fmt.get("filesize_approx")
        return {
            "source": "ytdlp",
            "url": url,
            "mime": fmt.get("mime_type") or f"{'video' if has_video else 'audio'}/{ext}",
            "ext": ext,
            "quality": str(fmt.get("format_note") or (f"{acodec} {int(abr)}k" if abr else ext)),
            "bitrate_kbps": int(abr) if abr else None,
            "has_video": has_video,
            "size_bytes": int(size) if size else None,
            "expires_at": expires_iso(url),
            "http_headers": fmt.get("http_headers") or {},
        }

    # Prefer different containers before a second rendition of the same type,
    # but keep more than one candidate so codec/network failure can fail over.
    def diverse(items: list[dict[str, Any]], limit: int = 4) -> list[dict[str, Any]]:
        first: list[dict[str, Any]] = []
        rest: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in items:
            ext = str(item.get("ext") or "bin")
            (rest if ext in seen else first).append(item)
            seen.add(ext)
        return (first + rest)[:limit]

    return [convert(fmt) for fmt in diverse(audio) + diverse(video)]


def format_manifest(video_id: str) -> dict[str, Any]:
    info = extract(video_id)
    audio: list[dict[str, Any]] = []
    video: list[dict[str, Any]] = []
    for fmt in info.get("formats", []):
        fid = fmt.get("format_id")
        ext = fmt.get("ext") or "bin"
        if _is_audio(fmt) and not _is_video(fmt):
            acodec = (fmt.get("acodec") or "").lower()
            target = "opus" if "opus" in acodec or ext == "webm" else "mp3"
            audio.append(
                {
                    "format_id": fid,
                    "ext": ext,
                    "quality": f"{acodec or ext}"
                    + (f" {int(fmt['abr'])}k" if fmt.get("abr") else ""),
                    "bitrate_kbps": int(fmt["abr"]) if fmt.get("abr") else None,
                    "has_video": False,
                    "target_container": target,
                    "filesize_bytes": int(fmt["filesize"] or fmt["filesize_approx"])
                    if (fmt.get("filesize") or fmt.get("filesize_approx"))
                    else None,
                }
            )
        elif _is_video(fmt) and _is_audio(fmt):
            h = fmt.get("height")
            video.append(
                {
                    "format_id": fid,
                    "ext": ext,
                    "quality": f"{h}p" if h else str(fmt.get("format_note") or "video"),
                    "width": fmt.get("width"),
                    "height": h,
                    "has_video": True,
                    "target_container": "mp4",
                    "filesize_bytes": int(fmt["filesize"] or fmt["filesize_approx"])
                    if (fmt.get("filesize") or fmt.get("filesize_approx"))
                    else None,
                }
            )
    video.sort(key=lambda f: (f.get("height") or 0), reverse=True)
    return {
        "video_id": video_id,
        "title": info.get("title") or "",
        "duration_sec": info.get("duration"),
        "audio": audio,
        "video": video,
    }


def meta(video_id: str) -> dict[str, Any]:
    info = extract(video_id)
    channel_id = info.get("channel_id")
    return track(
        video_id=video_id,
        title=info.get("title") or "",
        artists=[
            {
                "name": info.get("artist") or info.get("channel") or info.get("uploader") or "Unknown",
                "channel_id": channel_id,
                "url": f"https://music.youtube.com/channel/{channel_id}" if channel_id else None,
            }
        ],
        source="ytdlp",
        duration=info.get("duration"),
        artwork=(info.get("thumbnails") or [{}])[-1].get("url"),
        album=info.get("album"),
        category="video",
    )
