import time

from app.cache import TTLCache


def test_get_set_roundtrip():
    c = TTLCache(maxsize=8, ttl=60)
    assert c.get("missing") is None
    c.set("a", 123)
    assert c.get("a") == 123


def test_ttl_expiry():
    c = TTLCache(maxsize=8, ttl=0.05)
    c.set("a", "v")
    time.sleep(0.06)
    assert c.get("a") is None


def test_lru_eviction():
    c = TTLCache(maxsize=2, ttl=60)
    c.set("a", 1)
    c.set("b", 2)
    _ = c.get("a")  # refresh a → b becomes oldest
    c.set("c", 3)
    assert c.get("a") == 1
    assert c.get("b") is None
    assert c.get("c") == 3


def test_get_or_set_skips_none():
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        return None  # simulates a failed upstream → never cached

    c = TTLCache(maxsize=8, ttl=60)
    assert c.get_or_set("k", factory) is None
    assert c.get_or_set("k", factory) is None
    assert calls["n"] == 2, "failures must not be cached"
