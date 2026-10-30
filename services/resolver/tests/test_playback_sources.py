"""Deterministic W4 regressions: priority, failover and progressive formats."""
from fastapi.testclient import TestClient

from app import main
from app.sources import invidious_source, piped_source, ytdlp_source

client = TestClient(main.app)


def candidate(source, *, video=False):
    return {"source": source, "url": f"https://media.googlevideo.com/{source}",
            "mime": "video/mp4" if video else "audio/mp4", "ext": "mp4",
            "quality": "test", "has_video": video}


def test_initial_and_post_playback_failure_source_order(monkeypatch):
    monkeypatch.setattr(main.config, "MOCK", False)
    calls = []
    def primary(_):
        calls.append("ytdlp")
        return [candidate("ytdlp")]
    def mirror(name):
        def resolve(_):
            calls.append(name)
            return {"candidates": [candidate(name)], "related": []}
        return resolve
    monkeypatch.setattr(main.ytdlp_source, "stream_candidates", primary)
    monkeypatch.setattr(main.piped, "streams", mirror("piped"))
    monkeypatch.setattr(main.invidious, "streams", mirror("invidious"))
    first = client.get("/streams/priority0001?refresh=true").json()
    assert calls == ["ytdlp"]
    assert first["candidates"][0]["source"] == "ytdlp"
    calls.clear()
    second = client.get("/streams/priority0001?after=ytdlp&refresh=true").json()
    assert calls == ["piped"]
    assert second["candidates"][0]["source"] == "piped"
    calls.clear()
    third = client.get("/streams/priority0001?after=piped&refresh=true").json()
    assert calls == ["invidious"]
    assert third["candidates"][0]["source"] == "invidious"
    calls.clear()
    assert client.get("/streams/priority0001?after=invidious&refresh=true").status_code == 502
    assert calls == []


def test_primary_exception_falls_through_without_leaking_exception(monkeypatch):
    monkeypatch.setattr(main.config, "MOCK", False)
    def failed(_):
        raise RuntimeError("sensitive URL or token")
    monkeypatch.setattr(main.ytdlp_source, "stream_candidates", failed)
    monkeypatch.setattr(main.piped, "streams", lambda _: {"candidates": [], "related": []})
    monkeypatch.setattr(main.invidious, "streams", lambda _: {"candidates": [candidate("invidious")], "related": []})
    result = client.get("/streams/priority0002?refresh=true").json()
    assert result["candidates"][0]["source"] == "invidious"
    assert result["warnings"] == ["ytdlp_failed", "piped_empty", "invidious_fallback"]
    assert "sensitive" not in str(result)
    assert client.get("/streams/priority0002?mode=bad").status_code == 422


def test_video_mode_ignores_audio_and_uses_next_progressive_source(monkeypatch):
    monkeypatch.setattr(main.config, "MOCK", False)
    monkeypatch.setattr(main.ytdlp_source, "stream_candidates", lambda _: [candidate("ytdlp")])
    monkeypatch.setattr(main.piped, "streams", lambda _: {"candidates": [candidate("piped", video=True)], "related": []})
    result = client.get("/streams/priority0003?mode=video&refresh=true").json()
    assert result["candidates"][0]["source"] == "piped"
    assert result["candidates"][0]["has_video"] is True
    assert result["warnings"] == ["ytdlp_empty", "piped_fallback"]


def test_ytdlp_candidates_are_fresh_and_exclude_video_only(monkeypatch):
    extraction_calls = []
    def extract(video_id):
        extraction_calls.append(video_id)
        return {"formats": [
            {"url": "https://media.googlevideo.com/audio", "ext": "m4a", "acodec": "aac", "vcodec": "none", "abr": 128},
            {"url": "https://media.googlevideo.com/progressive", "ext": "mp4", "acodec": "aac", "vcodec": "h264", "height": 360},
            {"url": "https://media.googlevideo.com/video-only", "ext": "mp4", "acodec": "none", "vcodec": "h264", "height": 1080},
        ]}
    monkeypatch.setattr(ytdlp_source, "extract", extract)
    result = ytdlp_source.stream_candidates("fresh000001")
    assert [(c["url"].rsplit("/", 1)[-1], c["has_video"]) for c in result] == [("audio", False), ("progressive", True)]
    ytdlp_source.stream_candidates("fresh000001")
    assert len(extraction_calls) == 2


def test_fallback_formats_exclude_separate_video(monkeypatch):
    class Pool:
        def __init__(self, result): self.result = result
        def get_json(self, *args, **kwargs): return self.result
    piped = piped_source.PipedSource(Pool({"audioStreams": [], "videoStreams": [
        {"url": "https://media.googlevideo.com/prog", "mimeType": "video/mp4", "videoOnly": False, "quality": "360p"},
        {"url": "https://media.googlevideo.com/silent", "mimeType": "video/mp4", "videoOnly": True},
        {"url": "https://media.googlevideo.com/unknown", "mimeType": "video/mp4"},
    ]}))
    assert [c["url"].rsplit("/", 1)[-1] for c in piped.streams("video")["candidates"]] == ["prog"]
    invidious = invidious_source.InvidiousSource(Pool({"adaptiveFormats": [
        {"url": "https://media.googlevideo.com/silent", "type": "video/mp4"},
    ], "formatStreams": [{"url": "https://media.googlevideo.com/prog", "type": "video/mp4", "qualityLabel": "360p"}]}))
    assert [c["url"].rsplit("/", 1)[-1] for c in invidious.streams("video")["candidates"]] == ["prog"]


def test_mock_video_is_never_claimed_without_explicit_av_fixture(monkeypatch):
    monkeypatch.setattr(main.config, "MOCK", True)
    monkeypatch.delenv("THEMASHUP_FIXTURE_VIDEO", raising=False)
    response = client.get("/streams/mock00000001?mode=video&refresh=true")
    assert response.status_code == 502
    monkeypatch.setenv("THEMASHUP_FIXTURE_VIDEO", "1")
    video = client.get("/streams/mock00000001?mode=video&refresh=true").json()
    assert len(video["candidates"]) == 1
    assert video["candidates"][0]["has_video"] is True
    data = client.get("/mock/audio/mock00000001?fmt=video", headers={"Range": "bytes=0-99"})
    assert data.status_code == 206
    assert data.headers["content-type"].startswith("video/webm")
    assert data.content[:4] == b"\x1a\x45\xdf\xa3"
