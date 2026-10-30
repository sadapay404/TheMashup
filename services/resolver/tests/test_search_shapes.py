"""Deterministic normalization, source-order, and suggestion regressions."""
from fastapi.testclient import TestClient

from app import config, main
from app.cache import TTLCache
from app.normalize import parse_ytmusic_items
from app.sources import ytmusic_source


def test_flat_ytmusic_categories_and_types_are_respected():
    items = [
        {"category": "Songs", "resultType": "song", "videoId": "song-id", "title": "A song", "artists": [{"name": "Singer", "id": "UCs"}]},
        {"category": "Videos", "resultType": "video", "videoId": "video-id", "title": "A video", "artists": [{"name": "Singer"}]},
        {"category": "Artists", "resultType": "artist", "browseId": "UCs", "artist": "Singer"},
        {"category": "Albums", "resultType": "album", "browseId": "MPREa", "title": "An album", "artists": [{"name": "Singer"}]},
    ]
    tracks, artists, albums = parse_ytmusic_items(items)
    assert [(t["id"], t["category"]) for t in tracks] == [("song-id", "song"), ("video-id", "video")]
    assert artists[0]["name"] == "Singer"
    assert albums[0]["artist"] == "Singer"


def test_string_suggestions_do_not_trigger_a_fallback_search(monkeypatch):
    class Client:
        def get_search_suggestions(self, q):
            return ["Midnight", "Midnight Mirage", "Midnight"]
        def search(self, *args, **kwargs):
            raise AssertionError("an extra search must not occur")
    monkeypatch.setattr(ytmusic_source, "client", lambda: Client())
    assert ytmusic_source.suggestions("mid", 8) == ["Midnight", "Midnight Mirage"]


def test_grouped_suggestions_remain_compatible(monkeypatch):
    class Client:
        def get_search_suggestions(self, q):
            return [[{"text": "Neon Tide"}], "Neon"]
    monkeypatch.setattr(ytmusic_source, "client", lambda: Client())
    assert ytmusic_source.suggestions("neo") == ["Neon Tide", "Neon"]


def test_search_falls_back_youtube_then_piped_then_invidious(monkeypatch):
    monkeypatch.setattr(config, "MOCK", False)
    monkeypatch.setattr(main, "cache", TTLCache(maxsize=16, ttl=10))
    calls = []
    def failed(name):
        def call(*args):
            calls.append(name)
            raise RuntimeError("offline fixture")
        return call
    def invidious(*args):
        calls.append("invidious")
        return {"tracks": [], "artists": [], "albums": [], "source": "invidious"}
    monkeypatch.setattr(ytmusic_source, "search", failed("youtube"))
    monkeypatch.setattr(main.piped, "search", failed("piped"))
    monkeypatch.setattr(main.invidious, "search", invidious)
    response = TestClient(main.app).get("/search", params={"q": "fixture query"})
    assert response.status_code == 200
    assert calls == ["youtube", "piped", "invidious"]
    assert "invidious_fallback" in response.json()["warnings"]


def test_suggestions_outage_is_not_an_empty_success(monkeypatch):
    monkeypatch.setattr(config, "MOCK", False)
    monkeypatch.setattr(main, "cache", TTLCache(maxsize=16, ttl=10))
    def fail(*args):
        raise RuntimeError("offline fixture")
    monkeypatch.setattr(ytmusic_source, "suggestions", fail)
    monkeypatch.setattr(main.piped, "suggestions", fail)
    response = TestClient(main.app).get("/suggest", params={"q": "fixture query"})
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "SUGGESTIONS_UNAVAILABLE"


def test_youtube_success_never_calls_fallbacks(monkeypatch):
    monkeypatch.setattr(config, "MOCK", False)
    monkeypatch.setattr(main, "cache", TTLCache(maxsize=16, ttl=10))
    calls = []
    def youtube(*args):
        calls.append("youtube")
        return {"tracks": [], "artists": [], "albums": [], "source": "ytmusic", "warnings": []}
    def unexpected(*args):
        raise AssertionError("fallback called after primary success")
    monkeypatch.setattr(ytmusic_source, "search", youtube)
    monkeypatch.setattr(main.piped, "search", unexpected)
    monkeypatch.setattr(main.invidious, "search", unexpected)
    response = TestClient(main.app).get("/search", params={"q": "primary fixture"})
    assert response.status_code == 200
    assert calls == ["youtube"]
    assert response.json()["source"] == "ytmusic"


def test_piped_success_prevents_invidious_fallback(monkeypatch):
    monkeypatch.setattr(config, "MOCK", False)
    monkeypatch.setattr(main, "cache", TTLCache(maxsize=16, ttl=10))
    calls = []
    def youtube(*args):
        calls.append("youtube")
        raise RuntimeError("offline fixture")
    def piped(*args):
        calls.append("piped")
        return {"tracks": [], "artists": [], "albums": [], "source": "piped"}
    def unexpected(*args):
        raise AssertionError("invidious called after piped success")
    monkeypatch.setattr(ytmusic_source, "search", youtube)
    monkeypatch.setattr(main.piped, "search", piped)
    monkeypatch.setattr(main.invidious, "search", unexpected)
    response = TestClient(main.app).get("/search", params={"q": "piped fixture"})
    assert response.status_code == 200
    assert calls == ["youtube", "piped"]
    assert "piped_fallback" in response.json()["warnings"]


def test_piped_suggestions_accept_array_and_wrapped_response():
    from app.sources.piped_source import PipedSource
    class Pool:
        def __init__(self, value):
            self.value = value
        def get_json(self, *_args, **_kwargs):
            return self.value
    assert PipedSource(Pool(["one", "two"])).suggestions("o") == ["one", "two"]
    assert PipedSource(Pool({"suggestions": ["one"]})).suggestions("o") == ["one"]
    try:
        PipedSource(Pool({"unexpected": []})).suggestions("o")
        assert False, "invalid provider shape must not look like zero matches"
    except RuntimeError:
        pass
