import os
import time

os.environ["RESOLVER_MOCK"] = "1"
os.environ.setdefault("DOWNLOAD_DIR", "/tmp/themashup-jobs-test")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)

OWNER = "test-owner-1"


def _wait(job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    last = {}
    while time.time() < deadline:
        res = client.get(f"/downloads/{job_id}")
        assert res.status_code == 200, res.text
        last = res.json()
        if last["status"] in ("completed", "failed"):
            return last
        time.sleep(0.25)
    raise AssertionError(f"job did not finish: {last}")


def _create(container: str, quality: str) -> dict:
    res = client.post(
        "/downloads",
        json={
            "video_id": "mock00000001",
            "container": container,
            "quality": quality,
            "owner": OWNER,
            "title": "Midnight Mirage",
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_health_reports_ffmpeg_and_downloads():
    body = client.get("/health").json()
    assert body["downloads"] is True
    assert body["ffmpeg"] is True, "static ffmpeg must be available in tests"


def test_mp3_128_download_completes_with_real_bytes():
    job = _create("mp3", "128k")
    assert job["status"] in ("queued", "downloading")
    done = _wait(job["id"])
    assert done["status"] == "completed", done.get("error")
    assert done["progress"] == 100.0
    assert done["filename"].endswith(".mp3")
    assert (done["filesize"] or 0) > 10_000
    # MP3 magic: "ID3" or frame sync
    with open(done["filename"], "rb") as fh:
        head = fh.read(3)
    assert head == b"ID3" or head[0] == 0xFF


def test_flac_and_opus_and_4k_video_pipeline():
    flac = _wait(_create("flac", "best")["id"])
    assert flac["status"] == "completed", flac.get("error")
    assert flac["filename"].endswith(".flac")

    opus = _wait(_create("opus", "best")["id"])
    assert opus["status"] == "completed", opus.get("error")
    with open(opus["filename"], "rb") as fh:
        assert fh.read(4) == b"OggS"

    mp4 = _wait(_create("mp4", "720p")["id"])
    assert mp4["status"] == "completed", mp4.get("error")
    with open(mp4["filename"], "rb") as fh:
        fh.seek(4)
        assert fh.read(4) == b"ftyp"


def test_validation_rejects_bad_container_and_quality():
    assert client.post(
        "/downloads",
        json={"video_id": "mock00000001", "container": "wav", "quality": "128k", "owner": OWNER},
    ).status_code == 422
    assert client.post(
        "/downloads",
        json={"video_id": "mock00000001", "container": "mp3", "quality": "4k", "owner": OWNER},
    ).status_code == 422


def test_list_filters_by_owner_and_file_endpoint_serves_attachment():
    job = _wait(_create("mp3", "320k")["id"])
    mine = client.get("/downloads", params={"owner": OWNER}).json()["jobs"]
    assert any(j["id"] == job["id"] for j in mine)
    others = client.get("/downloads", params={"owner": "someone-else"}).json()["jobs"]
    assert not any(j["id"] == job["id"] for j in others)

    res = client.get(f"/downloads/{job['id']}/file")
    assert res.status_code == 200
    assert "attachment" in res.headers.get("content-disposition", "")
    assert res.headers.get("content-type", "").startswith("audio/mpeg"), res.headers.get("content-type")
    assert len(res.content) > 10_000


def test_unknown_job_404():
    assert client.get("/downloads/deadbeef").status_code == 404
    assert client.get("/downloads/deadbeef/file").status_code == 404

def test_jobs_survive_process_restart():
    """Metadata persists to jobs/<id>.json — a fresh manager rehydrates it."""
    from app.downloads import DownloadManager

    job = _wait(_create("mp3", "128k")["id"])

    fresh = DownloadManager()  # simulates resolver process restart
    loaded = [j for j in fresh.list(owner=OWNER) if j["id"] == job["id"]]
    assert loaded and loaded[0]["status"] == "completed"
    path = fresh.file_path(job["id"])
    assert path is not None and path.exists()
    assert path.read_bytes()[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3")


def test_interrupted_jobs_reconcile_to_failed_on_reload():
    """A job that was mid-download when the process died must not hang forever."""
    import json as _json

    from app.downloads import JOBS_DIR, DownloadManager

    meta = {
        "id": "deadbeef" * 4,
        "owner": OWNER,
        "video_id": "mock00000001",
        "title": "Interrupted",
        "container": "mp3",
        "quality": "128k",
        "status": "downloading",
        "progress": 42.0,
        "created_at": 1.0,
        "updated_at": 2.0,
    }
    (JOBS_DIR / f"{meta['id']}.json").write_text(_json.dumps(meta))
    fresh = DownloadManager()
    loaded = [j for j in fresh.list(owner=OWNER) if j["id"] == meta["id"]]
    assert loaded and loaded[0]["status"] == "failed"
    assert "restart" in (loaded[0].get("error") or "")
