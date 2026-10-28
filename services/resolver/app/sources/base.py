"""Shared HTTP helpers + instance-pool rotation for Piped / Invidious fallbacks."""

from __future__ import annotations

import time
from typing import Any

import httpx

from ..config import REQUEST_TIMEOUT


class InstancePool:
    """Rotates over mirror instances; skips any marked down for a cool-off period."""

    def __init__(self, instances: list[str], name: str):
        self.instances = [i.rstrip("/") for i in instances]
        self.name = name
        self._down: dict[str, float] = {}

    def mark_down(self, instance: str, seconds: float = 45.0) -> None:
        self._down[instance] = time.monotonic() + seconds

    def ordered(self) -> list[str]:
        now = time.monotonic()
        fresh = [i for i in self.instances if self._down.get(i, 0) < now]
        return fresh or self.instances  # if everything is cooling off, retry anyway

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        """GET path on the first healthy instance; returns parsed JSON or raises."""
        last_err: Exception | None = None
        for base in self.ordered():
            url = f"{base}{path}"
            try:
                with httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
                    res = client.get(url, params=params)
                    res.raise_for_status()
                    return res.json()
            except Exception as exc:  # noqa: BLE001 — any failure → try next mirror
                last_err = exc
                self.mark_down(base)
        raise RuntimeError(f"{self.name}: all instances failed ({last_err})")


def new_client() -> httpx.Client:
    return httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True)
