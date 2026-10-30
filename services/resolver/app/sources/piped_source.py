"""Piped API — fallback source for search / streams / related."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse, parse_qs

from ..normalize import expires_iso, parse_duration, track, best_thumb
from .base import InstancePool


def _video_id(item: dict[str, Any]) -> str | None:
    url = item.get("url") or ""
    if "/watch?v=" in url:
        return url.split("/watch?v=")[-1].split("&")[0]
    if item.get("id"):
        return str(item["id"])
    if item.get("url") and item["url"].startswith("watch?v="):
        return item["url"].split("=", 1)[1]
    return None


def _item_to_track(item: dict[str, Any], category: str = "song") -> dict[str, Any] | None:
    vid = _video_id(item)
    if not vid:
        return None
    thumbs = item.get("thumbnails") or (
        [item["thumbnail"]] if item.get("thumbnail") else []
    )
    if thumbs and isinstance(thumbs[0], str):
        thumbs = [{"url": u} for u in thumbs]
    return track(
        video_id=vid,
        title=item.get("title") or "",
        artists=[{"name": item.get("uploaderName") or item.get("uploader") or "Unknown"}],
        source="piped",
        duration=item.get("duration") or item.get("lengthSeconds"),
        artwork=best_thumb(thumbs),
        category=category,
    )


class PipedSource:
    def __init__(self, pool: InstancePool):
        self.pool = pool

    def search(self, query: str, limit: int = 20) -> dict[str, Any]:
        data = self.pool.get_json("/search", params={"q": query, "filter": "songs"})
        items = data.get("items") if isinstance(data, dict) else None
        tracks = [t for t in (_item_to_track(i) for i in items or []) if t][:limit]
        return {"tracks": tracks, "artists": [], "albums": [], "source": "piped", "warnings": []}

    def suggestions(self, query: str, limit: int = 8) -> list[str]:
        data = self.pool.get_json("/suggest", params={"q": query})
        # Piped's /suggest returns a JSON string array. Some mirrors wrap it.
        out = data if isinstance(data, list) else data.get("suggestions") if isinstance(data, dict) else None
        if isinstance(out, list):
            return [s for s in out if isinstance(s, str) and s.strip()][:limit]
        raise RuntimeError("piped: invalid suggestion response")

    def streams(self, video_id: str) -> dict[str, Any]:
        data = self.pool.get_json(f"/streams/{video_id}")
        candidates = []
        for a in data.get("audioStreams") or []:
            url = a.get("url")
            if not url:
                continue
            mime = a.get("mimeType") or "audio/webm"
            ext = "m4a" if "mp4" in mime else "webm" if "webm" in mime else "audio"
            bitrate = a.get("bitrate")
            candidates.append(
                {
                    "source": "piped",
                    "url": url,
                    "mime": mime,
                    "ext": ext,
                    "quality": a.get("quality") or (f"{int(bitrate // 1000)}k" if bitrate else ext),
                    "bitrate_kbps": int(bitrate // 1000) if bitrate else None,
                    "has_video": False,
                    "size_bytes": int(a["contentLength"]) if str(a.get("contentLength") or "").isdigit() else None,
                    "expires_at": expires_iso(url),
                    "http_headers": {"User-Agent": "Mozilla/5.0 (TheMashup)", "Referer": "https://www.youtube.com/"},
                }
            )
        # Highest bitrate first.
        candidates.sort(key=lambda c: c.get("bitrate_kbps") or 0, reverse=True)
        related = [t for t in (_item_to_track(i, "video") for i in data.get("relatedStreams") or []) if t]
        return {"candidates": candidates, "related": related, "raw": data}

    def related(self, video_id: str) -> list[dict[str, Any]]:
        data = self.pool.get_json(f"/streams/{video_id}")
        return [t for t in (_item_to_track(i, "video") for i in data.get("relatedStreams") or []) if t][:20]
