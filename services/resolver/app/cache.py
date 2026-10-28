"""Thread-safe TTL + LRU cache (sync endpoints run in FastAPI's threadpool)."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Hashable


class TTLCache:
    def __init__(self, maxsize: int = 1024, ttl: float = 300.0):
        self.maxsize = maxsize
        self.ttl = ttl
        self._data: OrderedDict[Hashable, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Hashable) -> Any | None:
        now = time.monotonic()
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at < now:
                del self._data[key]
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key: Hashable, value: Any, ttl: float | None = None) -> None:
        expires_at = time.monotonic() + (self.ttl if ttl is None else ttl)
        with self._lock:
            self._data[key] = (expires_at, value)
            self._data.move_to_end(key)
            while len(self._data) > self.maxsize:
                self._data.popitem(last=False)

    def get_or_set(self, key: Hashable, factory: Callable[[], Any], ttl: float | None = None) -> Any:
        cached = self.get(key)
        if cached is not None:
            return cached
        value = factory()
        # Do not cache failures so the next request can retry the source.
        if value is not None:
            self.set(key, value, ttl)
        return value

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)
