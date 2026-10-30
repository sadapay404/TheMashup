"""YouTube Music metadata via ytmusicapi (search, artist, home shelves)."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from ..normalize import parse_ytmusic_items, track, best_thumb


@lru_cache(maxsize=1)
def client():  # pragma: no cover - exercised only with live network
    from ytmusicapi import YTMusic

    return YTMusic()


def search(query: str, limit: int = 20) -> dict[str, Any]:
    """Primary search: YouTube Music (direct YT access is approved for personal use)."""
    raw = client().search(query, filter=None, limit=max(limit * 2, 20))
    tracks, artists, albums = parse_ytmusic_items(raw)
    return {
        "tracks": tracks[:limit],
        "artists": artists[:10],
        "albums": albums[:8],
        "source": "ytmusic",
        "warnings": [],
    }


def suggestions(query: str, limit: int = 8) -> list[str]:
    """Best-effort autocomplete: native suggestions when available, else search titles."""
    c = client()
    getter = getattr(c, "get_search_suggestions", None)
    if callable(getter):
        try:
            raw = getter(query)
            out: list[str] = []
            # Current ytmusicapi returns list[str]; older versions returned
            # grouped objects. Handle both without a second, slower search.
            for group in raw if isinstance(raw, list) else []:
                for item in group if isinstance(group, list) else [group]:
                    text = item if isinstance(item, str) else item.get("text") if isinstance(item, dict) else None
                    if isinstance(text, str) and text.strip() and text not in out:
                        out.append(text)
            if out:
                return out[:limit]
        except Exception:
            pass
    # Fallback: top titles from a songs search.
    raw = c.search(query, filter="songs", limit=limit)
    tracks, _, _ = parse_ytmusic_items(raw)
    return [t["title"] for t in tracks[:limit]]


def artist(channel_id: str) -> dict[str, Any]:
    data = client().get_artist(channel_id)
    name = data.get("channelTitle") or data.get("name") or "Unknown artist"
    songs_raw = data.get("songs")
    items: list[Any] = []
    if isinstance(songs_raw, dict):
        items = songs_raw.get("results") or songs_raw.get("contents") or []
    elif isinstance(songs_raw, list):
        items = songs_raw
    if not items and isinstance(data.get("tabs"), list):  # defensive: raw tab shape
        for tab in data["tabs"]:
            if isinstance(tab, dict) and isinstance(tab.get("content"), dict):
                items = tab["content"].get("results") or []
                if items:
                    break
    tracks, _, _ = parse_ytmusic_items({"category": "Songs", "contents": items})
    artist_entry = {
        "name": name,
        "channel_id": channel_id,
        "image": data.get("thumbnails", [{}])[-1].get("url")
        if isinstance(data.get("thumbnails"), list) and data["thumbnails"]
        else best_thumb(data.get("thumbnails")),
    }
    return {"artist": artist_entry, "tracks": tracks[:20]}


def charts(limit: int = 40) -> dict[str, Any]:
    """Home shelves (Quick picks etc.) → flat track list."""
    raw = client().get_home(limit=3)
    shelves = raw if isinstance(raw, list) else raw.get("shelves", []) if isinstance(raw, dict) else []
    tracks: list[dict] = []
    seen: set[str] = set()
    for shelf in shelves:
        if not isinstance(shelf, dict):
            continue
        items = shelf.get("contents") or shelf.get("items") or shelf.get("results")
        if not items and isinstance(shelf.get("content"), dict):
            items = shelf["content"].get("items") or shelf["content"].get("results")
        items = items or []
        t, _, _ = parse_ytmusic_items({"category": str(shelf.get("title") or ""), "contents": items})
        for item in t:
            if item["id"] not in seen:
                seen.add(item["id"])
                tracks.append(item)
        if len(tracks) >= limit:
            break
    return {"tracks": tracks[:limit], "source": "ytmusic", "warnings": []}


def search_artist_songs(artist_name: str, limit: int = 15) -> list[dict]:
    raw = client().search(artist_name, filter="songs", limit=limit)
    tracks, _, _ = parse_ytmusic_items(raw)
    return tracks[:limit]
