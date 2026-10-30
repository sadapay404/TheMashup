"""Private FastAPI head for Windows search and playback resolution.

No downloads, account or CORS endpoints; the socket is loopback-only.
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
for route in existing_app.routes:
    if getattr(route, "path", None) in {"/health", "/search", "/suggest", "/streams/{video_id}"} or (
        os.getenv("RESOLVER_MOCK") == "1" and getattr(route, "path", None) == "/mock/audio/{video_id}"
    ):
        app.router.routes.append(route)
uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False)).run(sockets=[listener])
