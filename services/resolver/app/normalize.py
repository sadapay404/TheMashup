"""Normalizers: upstream payloads (ytmusicapi / yt-dlp / Piped / Invidious)
→ the shared Track / StreamCandidate dict shapes consumed by the gateway."""

from __future__ import annotations

import re
from typing import Any, Iterable

_EXPIRE_RE = re.compile(r"[?&]expire=(\d+)")


def parse_duration(value: Any) -> int | None:
    """Accepts 214, '214', '3:34', '1:02:03'."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) if value > 0 else None
    s = str(value).strip()
    if s.isdigit():
        return int(s)
    parts = s.split(":")
    if 2 <= len(parts) <= 3 and all(p.strip().isdigit() for p in parts):
        try:
            nums = [int(p) for p in parts]
        except ValueError:
            return None
        total = 0
        for n in nums:
            total = total * 60 + n
        return total or None
    return None


def best_thumb(thumbnails: Any, pick: str = "max") -> str | None:
    if not isinstance(thumbnails, list) or not thumbnails:
        return None
    urls = [t.get("url") for t in thumbnails if isinstance(t, dict) and t.get("url")]
    if not urls:
        return None
    if pick == "min":
        return urls[0]
    def area(u: str) -> int:
        for t in thumbnails:
            if isinstance(t, dict) and t.get("url") == u:
                return int(t.get("width") or 0) * int(t.get("height") or 0)
        return 0
    return max(urls, key=area)


def track(
    *,
    video_id: str,
    title: str,
    artists: list[dict[str, Any]],
    source: str,
    duration: Any = None,
    artwork: str | None = None,
    album: str | None = None,
    popularity: int | None = None,
    category: str = "song",
    explicit: bool = False,
) -> dict[str, Any]:
    clean_artists = [
        {"name": a.get("name"), "channel_id": a.get("channel_id"), "url": a.get("url")}
        for a in artists
        if a and a.get("name")
    ]
    return {
        "id": video_id,
        "source": source,
        "external_id": video_id,
        "title": title or "Unknown title",
        "artists": clean_artists,
        "artist_names": ", ".join(a["name"] for a in clean_artists) or "Unknown artist",
        "album": album,
        "duration_sec": parse_duration(duration),
        "artwork": artwork,
        "artwork_best": artwork,
        "popularity": popularity,
        "explicit": bool(explicit),
        "category": category,
    }


def expires_iso(url: str) -> str | None:
    m = _EXPIRE_RE.search(url or "")
    if not m:
        return None
    import datetime as _dt

    try:
        ts = int(m.group(1))
        return _dt.datetime.fromtimestamp(ts, tz=_dt.timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError):
        return None


def iter_categories(data: Any) -> Iterable[tuple[str, list[Any]]]:
    """Yield (category_name, items) from the several shapes ytmusicapi returns."""
    if isinstance(data, list):
        yield ("", data)
        return
    if not isinstance(data, dict):
        return
    cats = data.get("categories")
    if isinstance(cats, list):
        for c in cats:
            if isinstance(c, dict):
                yield (str(c.get("category") or c.get("title") or ""), c.get("contents") or [])
        return
    if isinstance(data.get("contents"), list):
        yield (str(data.get("category") or ""), data["contents"])
        return
    if isinstance(data.get("results"), list):
        yield (str(data.get("category") or ""), data["results"])
        return


def parse_ytmusic_items(
    data: Any,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Returns (tracks, artists, albums) from a raw search / shelf payload."""
    tracks: list[dict] = []
    artists: list[dict] = []
    albums: list[dict] = []
    seen_artists: set[str] = set()
    seen_albums: set[str] = set()

    for category, items in iter_categories(data):
        for item in items:
            if not isinstance(item, dict):
                continue
            # ytmusicapi normally returns a flat list with category/resultType
            # on each item; older shelf payloads carry the category on the group.
            cat = str(item.get("category") or category).lower()
            video_id = item.get("videoId")
            browse_id = item.get("browseId") or item.get("playlistId")
            item_type = str(item.get("resultType") or item.get("type") or "").lower()

            # ── artists ────────────────────────────────────────────────
            if (
                "artist" in cat or item_type == "artist"
                or (isinstance(browse_id, str) and browse_id.startswith("UC") and not video_id)
            ):
                name = item.get("artist") or item.get("title")
                ch = browse_id if isinstance(browse_id, str) and browse_id.startswith("UC") else item.get("channelId") or item.get("id")
                if name and ch and ch not in seen_artists:
                    seen_artists.add(ch)
                    artists.append(
                        {
                            "name": name,
                            "channel_id": ch,
                            "image": best_thumb(item.get("thumbnails")),
                        }
                    )
                continue

            # ── albums ─────────────────────────────────────────────────
            if "album" in cat or item_type == "album":
                title = item.get("title")
                if title and str(title) not in seen_albums:
                    seen_albums.add(str(title))
                    albums.append(
                        {
                            "title": title,
                            "artist": next(
                                (a.get("name", "") for a in item.get("artists", []) if isinstance(a, dict)),
                                "",
                            ) if isinstance(item.get("artists"), list) else "",
                            "artwork": best_thumb(item.get("thumbnails")),
                            "id": browse_id if isinstance(browse_id, str) else None,
                        }
                    )
                continue

            # ── playable tracks / videos ───────────────────────────────
            if video_id:
                if "top result" in cat:
                    category_out = "top_result"
                elif "video" in cat or item_type == "video":
                    category_out = "video"
                else:
                    category_out = "song"
                tracks.append(
                    track(
                        video_id=video_id,
                        title=item.get("title") or "",
                        artists=[
                            {"name": a.get("name"), "channel_id": a.get("id")}
                            for a in (item.get("artists") or [])
                            if isinstance(a, dict) and a.get("name")
                        ],
                        source="ytmusic",
                        duration=item.get("duration_seconds") or item.get("duration"),
                        artwork=best_thumb(item.get("thumbnails")),
                        album=(item.get("album") or {}).get("name")
                        if isinstance(item.get("album"), dict)
                        else item.get("album"),
                        category=category_out,
                        explicit=bool(item.get("isExplicit")),
                    )
                )

    return tracks, artists, albums
