import os

# Must happen before app.main import so config.MOCK is True.
os.environ["RESOLVER_MOCK"] = "1"
os.environ["MOCK_PUBLIC_URL"] = "http://127.0.0.1:8000"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health_reports_mock_mode():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["mock"] is True
    assert body["priority"][0] == "ytdlp"


def test_search_matches_fixtures():
    res = client.get("/search", params={"q": "midnight"})
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "mock"
    assert any(t["title"] == "Midnight Mirage" for t in body["tracks"])
    assert body["tracks"][0]["id"].startswith("mock")


def test_search_requires_query():
    res = client.get("/search")
    assert res.status_code == 422


def test_suggest_autocomplete():
    res = client.get("/suggest", params={"q": "neo"})
    assert res.status_code == 200
    assert "Neon Tide" in res.json()["suggestions"]


def test_streams_returns_ordered_candidates_with_headers():
    res = client.get("/streams/mock00000001")
    assert res.status_code == 200
    body = res.json()
    assert body["video_id"] == "mock00000001"
    assert len(body["candidates"]) >= 3
    first = body["candidates"][0]
    assert first["source"] == "ytdlp"
    assert first["url"].startswith("http")
    assert "Referer" in first["http_headers"]
    assert body["warnings"] == ["mock_mode"]


def test_streams_unknown_id_404():
    res = client.get("/streams/notarealid123")
    assert res.status_code == 404


def test_formats_manifest():
    res = client.get("/formats/mock00000001")
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Midnight Mirage"
    assert any(a["target_container"] == "mp3" for a in body["audio"])
    assert any(v["height"] == 1080 for v in body["video"])


def test_meta_track_shape():
    res = client.get("/meta/mock00000001")
    assert res.status_code == 200
    t = res.json()
    assert t["id"] == "mock00000001"
    assert t["artist_names"] == "Nova Arcade"
    assert t["duration_sec"] == 214


def test_related_excludes_seed():
    res = client.get("/related/mock00000001")
    assert res.status_code == 200
    related = res.json()["related"]
    assert len(related) >= 4
    assert all(r["id"] != "mock00000001" for r in related)


def test_artist_and_charts():
    res = client.get("/artist/UCmock0000000A")
    assert res.status_code == 200
    assert res.json()["artist"]["name"] == "Nova Arcade"

    res = client.get("/charts")
    assert res.status_code == 200
    assert len(res.json()["tracks"]) >= 5


def test_mock_audio_full_and_range():
    res = client.get("/mock/audio/mock00000001")
    assert res.status_code == 200
    assert res.headers["accept-ranges"] == "bytes"
    full = res.content
    assert full[:4] == b"RIFF"
    assert len(full) > 50_000

    res = client.get("/mock/audio/mock00000001", headers={"Range": "bytes=0-99"})
    assert res.status_code == 206
    assert len(res.content) == 100
    assert res.headers["content-range"].startswith(f"bytes 0-99/{len(full)}")

    # Mid-file range (seek behaviour)
    res = client.get("/mock/audio/mock00000001", headers={"Range": "bytes=1000-1999"})
    assert res.status_code == 206
    assert res.content == full[1000:2000]


def test_mock_dead_candidate_404():
    res = client.get("/mock/audio/mock00000001", params={"fmt": "dead"})
    assert res.status_code == 404
