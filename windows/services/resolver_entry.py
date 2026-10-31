"""Private FastAPI head for the Windows-owned local host.

Exposes search, playback resolution and the download manager to the loopback
host only. No account, CORS or public endpoints; the socket is loopback-only.
"""
from __future__ import annotations

import socket
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listener.bind(("127.0.0.1", 0))
listener.listen(128)
# Only fixture mode may refer back to this private endpoint. Set before the
# shared resolver imports its immutable configuration.
if os.getenv("RESOLVER_MOCK") == "1":
    os.environ["MOCK_PUBLIC_URL"] = f"http://127.0.0.1:{listener.getsockname()[1]}"

from app.main import app as existing_app

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Announce only after the ASGI app reaches startup, not before imports.
    print(f"THEMASHUP_RESOLVER_PORT={listener.getsockname()[1]}", flush=True)
    yield

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None, lifespan=lifespan)
# Routes reachable through the private loopback host: search, playback and
# downloads. Kept as an explicit allowlist so account/CORS/public routes stay
# unreachable from the Windows-owned socket.
private_paths = {
    "/health", "/search", "/suggest", "/streams/{video_id}",
    "/downloads", "/downloads/{job_id}", "/downloads/{job_id}/file",
}
for route in existing_app.routes:
    if getattr(route, "path", None) in private_paths or (
        os.getenv("RESOLVER_MOCK") == "1" and getattr(route, "path", None) == "/mock/audio/{video_id}"
    ):
        app.router.routes.append(route)
uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False)).run(sockets=[listener])
