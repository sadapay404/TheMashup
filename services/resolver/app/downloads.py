"""Download manager (Phase 5).

Real mode:   yt-dlp with format selection + ffmpeg (system ffmpeg preferred,
             bundled static ffmpeg via imageio-ffmpeg as fallback).
Mock mode:   transcode the fixture WAV (or synthesize a test MP4) with the
             same ffmpeg — the FULL pipeline stays testable offline.

Jobs: queued → downloading(progress, speed, eta) → processing → completed|failed
Concurrency: 2 workers (blueprint). Files land in ./jobs (git-ignored).
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from . import mock
from .config import MOCK

JOBS_DIR = Path(os.getenv("DOWNLOAD_DIR", "jobs")).resolve()

CONTAINERS = {"mp3", "flac", "opus", "mp4"}
AUDIO_QUALITIES = {"128k", "320k", "best"}
VIDEO_QUALITIES = {"360p", "720p", "1080p", "4k"}


def find_ffmpeg() -> str | None:
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return None


FFMPEG = find_ffmpeg()

_VIDEO_HEIGHT = {"360p": 360, "720p": 720, "1080p": 1080, "4k": 2160}
_MOCK_SIZE = {"360p": (640, 360), "720p": (1280, 720), "1080p": (1920, 1080), "4k": (1920, 1080)}


def _sweep_old_files() -> None:
    if not JOBS_DIR.exists():
        return
    cutoff = time.time() - 24 * 3600
    for p in JOBS_DIR.iterdir():
        try:
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            pass


class DownloadManager:
    def __init__(self, max_workers: int = 2):
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="dl")
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        _sweep_old_files()
        self._load_existing()

    # ── persistence: jobs/<id>.json survives restarts ───────────────────────

    def _meta_path(self, job_id: str) -> Path:
        return JOBS_DIR / f"{job_id}.json"

    def _save(self, job_id: str) -> None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return
            data = {k: v for k, v in job.items() if k != "cancelled"}
        try:
            self._meta_path(job_id).write_text(json.dumps(data))
        except OSError:
            pass

    def _load_existing(self) -> None:
        """Rehydrate job metadata after a restart; reconcile in-flight jobs."""
        for meta in JOBS_DIR.glob("*.json"):
            try:
                data = json.loads(meta.read_text())
            except (OSError, ValueError):
                continue
            if not isinstance(data, dict) or "id" not in data or "status" not in data:
                continue
            data["cancelled"] = False
            status = data.get("status")
            if status in ("queued", "downloading", "processing"):
                data.update(
                    status="failed",
                    error="interrupted by restart",
                    speed_bps=None,
                    eta_s=None,
                )
            elif status == "completed":
                fn = data.get("filename")
                if not fn or not Path(fn).exists():
                    data.update(
                        status="failed",
                        error="file no longer exists",
                        filename=None,
                        filesize=None,
                    )
            with self.lock:
                self.jobs[str(data["id"])] = data

    # ── lifecycle ────────────────────────────────────────────────────

    def create(
        self,
        *,
        owner: str,
        video_id: str,
        container: str,
        quality: str,
        title: str | None = None,
    ) -> dict[str, Any]:
        if container not in CONTAINERS:
            raise ValueError(f"unsupported container '{container}'")
        allowed = VIDEO_QUALITIES if container == "mp4" else AUDIO_QUALITIES
        if quality not in allowed:
            raise ValueError(f"quality '{quality}' invalid for {container}")

        job_id = uuid.uuid4().hex
        now = time.time()
        job: dict[str, Any] = {
            "id": job_id,
            "owner": owner,
            "video_id": video_id,
            "title": title or video_id,
            "container": container,
            "quality": quality,
            "status": "queued",
            "progress": 0.0,
            "speed_bps": None,
            "eta_s": None,
            "filesize": None,
            "filename": None,
            "error": None,
            "warning": None,
            "cancelled": False,
            "created_at": now,
            "updated_at": now,
        }
        with self.lock:
            self.jobs[job_id] = job
        self._save(job_id)
        self.executor.submit(self._run, job_id)
        return self.snapshot(job_id)

    def _update(self, job_id: str, **fields: Any) -> None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return
            job.update(fields)
            job["updated_at"] = time.time()
        self._save(job_id)

    def _get(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            return self.jobs.get(job_id)

    def snapshot(self, job_id: str) -> dict[str, Any]:
        job = self._get(job_id)
        if not job:
            raise KeyError(job_id)
        with self.lock:
            return {k: v for k, v in job.items() if k != "cancelled"}

    def list(self, owner: str | None = None) -> list[dict[str, Any]]:
        with self.lock:
            jobs = [
                {k: v for k, v in job.items() if k != "cancelled"}
                for job in self.jobs.values()
                if owner is None or job["owner"] == owner
            ]
        return sorted(jobs, key=lambda j: j["created_at"], reverse=True)

    def cancel(self, job_id: str, owner: str | None = None) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or (owner is not None and job["owner"] != owner):
                return None
            job["cancelled"] = True
        if job["status"] in ("queued", "downloading"):
            self._update(job_id, status="failed", error="cancelled")
        else:
            self._save(job_id)
        return self.snapshot(job_id)

    def file_path(self, job_id: str) -> Path | None:
        job = self._get(job_id)
        if not job or not job.get("filename"):
            return None
        p = Path(job["filename"])
        return p if p.exists() else None

    # ── worker ───────────────────────────────────────────────────────

    def _run(self, job_id: str) -> None:
        job = self._get(job_id)
        if not job:
            return
        if job.get("cancelled"):
            self._update(job_id, status="failed", error="cancelled")
            return
        self._update(job_id, status="downloading", progress=1.0)
        try:
            if MOCK:
                self._run_mock(job_id)
            else:
                self._run_ytdlp(job_id)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc) or exc.__class__.__name__
            status = "failed"
            self._update(job_id, status=status, error=msg[:500], speed_bps=None, eta_s=None)

    def _finish(self, job_id: str, path: Path) -> None:
        size = path.stat().st_size if path.exists() else None
        self._update(
            job_id,
            status="completed",
            progress=100.0,
            filename=str(path),
            filesize=size,
            speed_bps=None,
            eta_s=None,
        )

    # ── live: yt-dlp ─────────────────────────────────────────────────

    def _run_ytdlp(self, job_id: str) -> None:
        import yt_dlp

        job = self._get(job_id)
        assert job is not None
        container, quality = job["container"], job["quality"]
        outtmpl = str(JOBS_DIR / f"{job_id}.%(ext)s")

        def on_progress(d: dict[str, Any]) -> None:
            current = self._get(job_id) or {}
            if current.get("cancelled"):
                raise yt_dlp.utils.DownloadError("cancelled")
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                done = d.get("downloaded_bytes") or 0
                pct = min(99.0, (done / total * 100) if total else 0.0)
                self._update(
                    job_id,
                    progress=round(pct, 1),
                    speed_bps=d.get("speed"),
                    eta_s=d.get("eta"),
                    filesize=total,
                )
            elif d.get("status") == "finished":
                self._update(job_id, progress=99.0, speed_bps=None, eta_s=None, status="processing")

        def on_postprocessor(d: dict[str, Any]) -> None:
            if d.get("status") == "started":
                self._update(job_id, status="processing", progress=99.0)

        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "outtmpl": outtmpl,
            "progress_hooks": [on_progress],
            "postprocessor_hooks": [on_postprocessor],
            "retries": 2,
        }
        if FFMPEG:
            opts["ffmpeg_location"] = FFMPEG

        if container == "mp4":
            h = _VIDEO_HEIGHT[quality]
            opts["format"] = f"bv*[height<={h}]+ba/b[height<={h}]/b"
            opts["merge_output_format"] = "mp4"
        else:
            opts["format"] = "bestaudio/best"
            audio_format = {"mp3": "mp3", "flac": "flac", "opus": "opus"}[container]
            opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": audio_format,
                    "preferredquality": quality if quality != "best" else "0",
                }
            ]
            if container == "mp3" and quality in ("128k", "320k"):
                opts["postprocessors"][0]["preferredquality"] = quality.replace("k", "K")

        url = f"https://www.youtube.com/watch?v={job['video_id']}"
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        produced = sorted(glob.glob(str(JOBS_DIR / f"{job_id}.*")))
        produced = [p for p in produced if not p.endswith((".part", ".json"))]
        if not produced:
            raise RuntimeError("yt-dlp produced no output file")
        self._finish(job_id, Path(produced[-1]))

    # ── mock: ffmpeg over fixtures (offline E2E) ─────────────────────

    def _run_mock(self, job_id: str) -> None:
        job = self._get(job_id)
        assert job is not None
        container, quality = job["container"], job["quality"]
        src = JOBS_DIR / f"{job_id}_src.wav"

        # 1) "download": stream the fixture tone into place with live progress
        blob = mock.wav(job["video_id"])
        chunk = max(1, len(blob) // 40)
        written = 0
        with open(src, "wb") as fh:
            while written < len(blob):
                if (self._get(job_id) or {}).get("cancelled"):
                    raise RuntimeError("cancelled")
                fh.write(blob[written : written + chunk])
                written += chunk
                self._update(
                    job_id,
                    progress=round(1 + (written / len(blob)) * 79, 1),
                    speed_bps=int(chunk / 0.03) if chunk else None,
                    eta_s=1,
                )
                time.sleep(0.03)
        self._update(job_id, status="processing", progress=90.0, speed_bps=None, eta_s=None)

        # 2) "postprocess": real ffmpeg transcode / synthetic test video
        if not FFMPEG:
            # Graceful degrade: hand back the WAV with a clear warning.
            out = JOBS_DIR / f"{job_id}.wav"
            shutil.move(str(src), out)
            self._update(job_id, warning="ffmpeg unavailable — served source WAV")
            self._finish(job_id, out)
            return

        if container == "mp4":
            w, h = _MOCK_SIZE[quality]
            out = JOBS_DIR / f"{job_id}.mp4"
            cmd = [
                FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", f"testsrc=duration=4:size={w}x{h}:rate=24",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-shortest", str(out),
            ]
        else:
            out = JOBS_DIR / f"{job_id}.{container}"
            if container == "mp3":
                bitrate = "128k" if quality == "128k" else "320k"
                codec = ["-codec:a", "libmp3lame", "-b:a", bitrate]
            elif container == "flac":
                codec = ["-codec:a", "flac"]
            else:  # opus
                codec = ["-codec:a", "libopus", "-b:a", "160k"]
            cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vn", *codec, str(out)]

        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        try:
            src.unlink(missing_ok=True)
        except OSError:
            pass
        if proc.returncode != 0 or not out.exists():
            raise RuntimeError(f"ffmpeg failed: {proc.stderr.strip()[:300] or 'unknown error'}")
        self._finish(job_id, out)


manager = DownloadManager()
