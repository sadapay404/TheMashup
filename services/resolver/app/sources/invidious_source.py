"""Invidious API — last-resort fallback for search / streams / related."""

from __future__ import annotations

from typing import Any

from ..normalize import expires_iso, track, best_thumb
from .base import InstancePool


def _item_to_track(item: dict[str, Any], category: str = "video") -> dict[str, Any] | None:
    vid = item.get("videoId") or item.get("id")
    if not vid:
        return None
    return track(
        video_id=str(vid),
        title=item.get("title") or "",
        artists=[
            {
                "name": item.get("author") or item.get("uploader") or "Unknown",
                "channel_id": item.get("authorId"),
            }
        ],
        source="invidious",
        duration=item.get("lengthSeconds") or item.get("lengthSeconds"),
        artwork=best_thumb(item.get("videoThumbnails") or item.get("thumbnails")),
        category=category,
    )


class InvidiousSource:
    def __init__(self, pool: InstancePool):
        self.pool = pool

    def search(self, query: str, limit: int = 20) -> dict[str, Any]:
        data = self.pool.get_json("/api/v1/search", params={"q": query, "type": "video"})
        items = data if isinstance(data, list) else data.get("items") or []
        tracks = [t for t in (_item_to_track(i, "video") for i in items) if t][:limit]
        return {"tracks": tracks, "artists": [], "albums": [], "source": "invidious", "warnings": []}

    def streams(self, video_id: str) -> dict[str, Any]:
        data = self.pool.get_json(f"/api/v1/videos/{video_id}")
        candidates = []
        for f in data.get("adaptiveFormats") or []:
            ftype = str(f.get("type") or "")
            if not ftype.startswith("audio"):
                continue
            url = f.get("url")
            if not url:
                continue
            ext = "m4a" if "mp4" in ftype else "webm" if "webm" in ftype else "audio"
            bitrate = f.get("bitrate")
            size = f.get("contentLength") or f.get("size")
            candidates.append(
                {
                    "source": "invidious",
                    "url": url,
                    "mime": ftype,
                    "ext": ext,
                    "quality": f.get("audioQuality") or (f"{int(bitrate // 1000)}k" if bitrate else ext),
                    "bitrate_kbps": int(bitrate // 1000) if bitrate else None,
                    "has_video": False,
                    "size_bytes": int(size) if str(size or "").isdigit() else None,
                    "expires_at": expires_iso(url),
                    "http_headers": {"User-Agent": "Mozilla/5.0 (TheMashup)", "Referer": "https://www.youtube.com/"},
                }
            )
        candidates.sort(key=lambda c: c.get("bitrate_kbps") or 0, reverse=True)
        related_items = data.get("recommendedVideos") or data.get("recommendations") or []
        related = [t for t in (_item_to_track(i) for i in related_items) if t]
        return {"candidates": candidates, "related": related, "raw": data}

    def related(self, video_id: str) -> list[dict[str, Any]]:
        data = self.pool.get_json(f"/api/v1/videos/{video_id}")
        items = data.get("recommendedVideos") or data.get("recommendations") or []
        return [t for t in (_item_to_track(i) for i in items) if t][:20]

    def trending(self, limit: int = 40) -> list[dict[str, Any]]:
        data = self.pool.get_json("/api/v1/trending", params={"region": "US"})
        items = data if isinstance(data, list) else []
        return [t for t in (_item_to_track(i) for i in items) if t][:limit]
