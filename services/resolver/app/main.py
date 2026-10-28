"""TheMashup resolver microservice.

Source priority (product decision: personal use, YouTube first):
  1. yt-dlp direct  →  2. Piped mirrors  →  3. Invidious mirrors
Every public endpoint degrades gracefully and reports which source answered.
"""

from __future__ import annotations

import time

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field

from . import config, mock
from .cache import TTLCache
from .downloads import CONTAINERS, AUDIO_QUALITIES, VIDEO_QUALITIES, FFMPEG, manager
from .sources.base import InstancePool
from .sources import invidious_source, piped_source, ytdlp_source, ytmusic_source

app = FastAPI(title="TheMashup Resolver", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

cache = TTLCache(maxsize=1024, ttl=300)
piped_pool = InstancePool(config.PIPED_INSTANCES, "piped")
invidious_pool = InstancePool(config.INVIDIOUS_INSTANCES, "invidious")
piped = piped_source.PipedSource(piped_pool)
invidious = invidious_source.InvidiousSource(invidious_pool)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "mock": config.MOCK,
        "priority": config.SOURCE_PRIORITY,
        "piped_instances": len(config.PIPED_INSTANCES),
        "invidious_instances": len(config.INVIDIOUS_INSTANCES),
        "cache_entries": len(cache),
        "ffmpeg": bool(FFMPEG),
        "downloads": True,
    }


# ── search & suggestions ─────────────────────────────────────────────────────

@app.get("/search")
def search(q: str = Query(min_length=1, max_length=200), limit: int = Query(20, ge=1, le=50)) -> dict:
    key = ("search", q.lower(), limit)
    cached = cache.get(key)
    if cached:
        return cached

    warnings: list[str] = []
    if config.MOCK:
        out = mock.search(q, limit)
        cache.set(key, out, ttl=60)
        return out

    # 1) YouTube Music (primary metadata source)
    try:
        out = ytmusic_source.search(q, limit)
        cache.set(key, out)
        return out
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"ytmusic_failed: {exc}")

    # 2) Piped
    try:
        out = piped.search(q, limit)
        out["warnings"] = warnings + ["piped_fallback"]
        cache.set(key, out, ttl=120)
        return out
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"piped_failed: {exc}")

    # 3) Invidious
    try:
        out = invidious.search(q, limit)
        out["warnings"] = warnings + ["invidious_fallback"]
        cache.set(key, out, ttl=120)
        return out
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"invidious_failed: {exc}")

    raise HTTPException(502, detail={"code": "SEARCH_FAILED", "warnings": warnings})


@app.get("/suggest")
def suggest(q: str = Query(min_length=1, max_length=200), limit: int = Query(8, ge=1, le=15)) -> dict:
    key = ("suggest", q.lower(), limit)
    cached = cache.get(key)
    if cached:
        return cached
    if config.MOCK:
        out = {"suggestions": mock.suggestions(q, limit)}
        cache.set(key, out, ttl=120)
        return out

    for name, fn in (("ytmusic", ytmusic_source.suggestions), ("piped", piped.suggestions)):
        try:
            out = {"suggestions": fn(q, limit)}
            cache.set(key, out, ttl=120)
            return out
        except Exception:  # noqa: BLE001
            continue
    # Last resort: never fail the search bar over suggestions.
    return {"suggestions": []}


# ── streams (primary: yt-dlp → piped → invidious) ────────────────────────────

@app.get("/streams/{video_id}")
def streams(video_id: str) -> dict:
    key = ("streams", video_id)
    cached = cache.get(key)
    if cached:
        return cached

    warnings: list[str] = []
    started = time.monotonic()

    if config.MOCK:
        try:
            raw = mock.streams(video_id)
        except KeyError as exc:
            raise HTTPException(404, detail=str(exc)) from exc
        out = {
            "video_id": video_id,
            "candidates": raw["candidates"],
            "resolution_ms": int((time.monotonic() - started) * 1000),
            "degraded": False,
            "warnings": ["mock_mode"],
            "related": raw["related"],
        }
        cache.set(key, out, ttl=300)
        return out

    # 1) yt-dlp direct (PRIMARY)
    try:
        candidates = ytdlp_source.stream_candidates(video_id)
        if candidates:
            out = {
                "video_id": video_id,
                "candidates": candidates,
                "resolution_ms": int((time.monotonic() - started) * 1000),
                "degraded": False,
                "warnings": [],
            }
            # Short TTL: googlevideo URLs expire (usually ~6h).
            cache.set(key, out, ttl=60 * 60)
            return out
        warnings.append("ytdlp_empty")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"ytdlp_failed: {exc}")

    # 2) Piped mirrors
    try:
        raw = piped.streams(video_id)
        if raw["candidates"]:
            out = {
                "video_id": video_id,
                "candidates": raw["candidates"],
                "resolution_ms": int((time.monotonic() - started) * 1000),
                "degraded": True,
                "warnings": warnings + ["piped_fallback"],
                "related": raw["related"],
            }
            cache.set(key, out, ttl=30 * 60)
            return out
        warnings.append("piped_empty")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"piped_failed: {exc}")

    # 3) Invidious mirrors
    try:
        raw = invidious.streams(video_id)
        if raw["candidates"]:
            out = {
                "video_id": video_id,
                "candidates": raw["candidates"],
                "resolution_ms": int((time.monotonic() - started) * 1000),
                "degraded": True,
                "warnings": warnings + ["invidious_fallback"],
                "related": raw["related"],
            }
            cache.set(key, out, ttl=30 * 60)
            return out
        warnings.append("invidious_empty")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"invidious_failed: {exc}")

    raise HTTPException(502, detail={"code": "STREAM_RESOLUTION_FAILED", "video_id": video_id, "warnings": warnings})


# ── formats / metadata / related / artist / charts ───────────────────────────

@app.get("/formats/{video_id}")
def formats(video_id: str) -> dict:
    key = ("formats", video_id)
    cached = cache.get(key)
    if cached:
        return cached
    try:
        if config.MOCK:
            out = mock.formats(video_id)
        else:
            out = ytdlp_source.format_manifest(video_id)
    except KeyError as exc:
        raise HTTPException(404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, detail={"code": "FORMATS_FAILED", "cause": str(exc)}) from exc
    cache.set(key, out, ttl=60 * 60)
    return out


@app.get("/meta/{video_id}")
def meta(video_id: str) -> dict:
    key = ("meta", video_id)
    cached = cache.get(key)
    if cached:
        return cached
    try:
        if config.MOCK:
            out = mock.meta(video_id)
        else:
            out = ytdlp_source.meta(video_id)
    except KeyError as exc:
        raise HTTPException(404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, detail={"code": "META_FAILED", "cause": str(exc)}) from exc
    cache.set(key, out, ttl=60 * 60)
    return out


@app.get("/related/{video_id}")
def related(video_id: str) -> dict:
    key = ("related", video_id)
    cached = cache.get(key)
    if cached:
        return cached
    if config.MOCK:
        out = {"track_id": video_id, "related": mock.related(video_id), "source": "mock"}
        cache.set(key, out, ttl=300)
        return out

    warnings: list[str] = []
    # Piped's streams payload ships relatedStreams.
    try:
        items = piped.related(video_id)
        if items:
            out = {"track_id": video_id, "related": items, "source": "piped"}
            cache.set(key, out, ttl=30 * 60)
            return out
        warnings.append("piped_empty")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"piped_failed: {exc}")

    try:
        items = invidious.related(video_id)
        if items:
            out = {"track_id": video_id, "related": items, "source": "invidious"}
            cache.set(key, out, ttl=30 * 60)
            return out
        warnings.append("invidious_empty")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"invidious_failed: {exc}")

    # Last resort: same-artist songs from YouTube Music.
    try:
        info = ytdlp_source.meta(video_id)
        items = ytmusic_source.search_artist_songs(info["artist_names"], limit=15)
        if items:
            out = {"track_id": video_id, "related": items, "source": "ytmusic", "warnings": warnings}
            cache.set(key, out, ttl=30 * 60)
            return out
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"ytmusic_failed: {exc}")

    raise HTTPException(502, detail={"code": "RELATED_FAILED", "warnings": warnings})


@app.get("/artist/{channel_id}")
def artist(channel_id: str) -> dict:
    key = ("artist", channel_id)
    cached = cache.get(key)
    if cached:
        return cached
    try:
        if config.MOCK:
            out = mock.artist(channel_id)
        else:
            out = ytmusic_source.artist(channel_id)
    except KeyError as exc:
        raise HTTPException(404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, detail={"code": "ARTIST_FAILED", "cause": str(exc)}) from exc
    cache.set(key, out, ttl=60 * 60)
    return out


@app.get("/charts")
def charts() -> dict:
    key = ("charts",)
    cached = cache.get(key)
    if cached:
        return cached
    if config.MOCK:
        out = mock.charts()
        cache.set(key, out, ttl=60)
        return out

    warnings: list[str] = []
    try:
        out = ytmusic_source.charts()
        if out["tracks"]:
            cache.set(key, out, ttl=30 * 60)
            return out
        warnings.append("ytmusic_empty")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"ytmusic_failed: {exc}")

    try:
        items = invidious.trending()
        if items:
            out = {"tracks": items, "source": "invidious", "warnings": warnings + ["invidious_fallback"]}
            cache.set(key, out, ttl=30 * 60)
            return out
        warnings.append("invidious_empty")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"invidious_failed: {exc}")

    raise HTTPException(502, detail={"code": "CHARTS_FAILED", "warnings": warnings})


# ── mock audio (only mounted in mock mode) ───────────────────────────────────

@app.get("/mock/audio/{video_id}")
def mock_audio(request: Request, video_id: str, fmt: str = "opus") -> Response:
    if not config.MOCK:
        raise HTTPException(404)
    if fmt == "dead":
        raise HTTPException(404, detail="deliberately dead mock candidate")
    blob = mock.wav(video_id, fmt)
    total = len(blob)
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    range_header = request.headers.get("range")
    if range_header and range_header.startswith("bytes="):
        spec = range_header[6:].split("-", 1)
        try:
            start = int(spec[0]) if spec[0] else 0
            end = int(spec[1]) if len(spec) > 1 and spec[1] else total - 1
        except ValueError:
            start, end = 0, total - 1
        start = max(0, min(start, total - 1))
        end = max(start, min(end, total - 1))
        chunk = blob[start : end + 1]
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        headers["Content-Length"] = str(len(chunk))
        return Response(chunk, status_code=206, media_type="audio/wav", headers=headers)
    headers["Content-Length"] = str(total)
    return Response(blob, media_type="audio/wav", headers=headers)


# ── download manager (Phase 5) ───────────────────────────────────────────────


class DownloadRequest(BaseModel):
    video_id: str = Field(min_length=6, max_length=24)
    container: str
    quality: str
    owner: str = Field(min_length=1, max_length=128)
    title: str | None = Field(default=None, max_length=300)


def _validate(container: str, quality: str) -> None:
    if container not in CONTAINERS:
        raise HTTPException(422, detail=f"container must be one of {sorted(CONTAINERS)}")
    allowed = VIDEO_QUALITIES if container == "mp4" else AUDIO_QUALITIES
    if quality not in allowed:
        raise HTTPException(422, detail=f"quality must be one of {sorted(allowed)} for {container}")


@app.post("/downloads")
def create_download(body: DownloadRequest) -> dict:
    _validate(body.container, body.quality)
    try:
        return manager.create(
            owner=body.owner,
            video_id=body.video_id,
            container=body.container,
            quality=body.quality,
            title=body.title,
        )
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


@app.get("/downloads")
def list_downloads(owner: str | None = None) -> dict:
    return {"jobs": manager.list(owner)}


@app.get("/downloads/{job_id}")
def get_download(job_id: str) -> dict:
    try:
        return manager.snapshot(job_id)
    except KeyError as exc:
        raise HTTPException(404, detail="job not found") from exc


@app.delete("/downloads/{job_id}")
def cancel_download(job_id: str, owner: str | None = None) -> dict:
    job = manager.cancel(job_id, owner)
    if not job:
        raise HTTPException(404, detail="job not found")
    return job


@app.get("/downloads/{job_id}/file")
def download_file(job_id: str):
    from fastapi.responses import FileResponse

    job = manager._get(job_id)
    if job is None:
        raise HTTPException(404, detail="job not found")
    job_path = manager.file_path(job_id)
    if job_path is None:
        if job["status"] == "completed":
            raise HTTPException(410, detail="file no longer exists")
        raise HTTPException(409, detail=f"job is {job['status']}")
    name = f"{job['title'][:60]}.{job_path.suffix.lstrip('.')}"
    safe_name = "".join(c if c.isalnum() or c in " .-_" else "_" for c in name)
    import mimetypes

    media_type = mimetypes.guess_type(str(job_path))[0] or "application/octet-stream"
    return FileResponse(
        job_path,
        media_type=media_type,
        filename=safe_name,
        content_disposition_type="attachment",
    )
