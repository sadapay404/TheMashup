"""Private, search-only FastAPI head for the Windows development host.

Reuses the monorepo resolver's real handlers but exposes no download/stream or
CORS endpoints. The socket is allocated by the OS and is loopback-only.
"""
from __future__ import annotations

import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

from app.main import app as existing_app

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Announce only after the ASGI app reaches startup, not before imports.
    print(f"THEMASHUP_RESOLVER_PORT={listener.getsockname()[1]}", flush=True)
    yield

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None, lifespan=lifespan)
for route in existing_app.routes:
    if getattr(route, "path", None) in {"/health", "/search", "/suggest"}:
        app.router.routes.append(route)

listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listener.bind(("127.0.0.1", 0))
listener.listen(128)
uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False)).run(sockets=[listener])
