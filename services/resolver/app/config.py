import os


def _flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")


def _list(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [x.strip() for x in raw.split(",") if x.strip()]


PORT = int(os.getenv("RESOLVER_PORT", "8000"))
HOST = os.getenv("RESOLVER_HOST", "0.0.0.0")

# 1 = fixtures + local mock audio instead of YouTube / Piped / Invidious.
MOCK = _flag("RESOLVER_MOCK")

# Base URL the mock uses to advertise its own audio files (must be gateway-reachable).
MOCK_PUBLIC_URL = os.getenv("MOCK_PUBLIC_URL", f"http://127.0.0.1:{PORT}").rstrip("/")

REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "8"))

# Fallback pools. yt-dlp (direct YouTube) is PRIMARY per product decision;
# Piped and Invidious only engage when the primary fails.
PIPED_INSTANCES = _list(
    "PIPED_INSTANCES",
    "https://pipedapi.kavin.rocks,https://pipedapi.adminforge.de,https://api.piped.yt",
)
INVIDIOUS_INSTANCES = _list(
    "INVIDIOUS_INSTANCES",
    "https://inv.nadeko.net,https://yewtu.be,https://invidious.nerdvpn.de",
)

SOURCE_PRIORITY = ["ytdlp", "piped", "invidious"]
