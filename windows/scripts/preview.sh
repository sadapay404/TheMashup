#!/usr/bin/env bash
set -euo pipefail

# Publish the browser head only; this does not build an EXE or run Android.
WINDOWS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WINDOWS_DIR"
if ! command -v dotnet >/dev/null 2>&1; then
  echo 'The .NET 10 SDK is required. See windows/README.md.' >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3 is required to serve the browser preview.' >&2
  exit 1
fi

dotnet publish src/TheMashup.Browser/TheMashup.Browser.csproj -c Release --nologo
WEBROOT="$WINDOWS_DIR/src/TheMashup.Browser/bin/Release/net10.0-browser/publish/wwwroot"
if [[ ! -f "$WEBROOT/index.html" ]]; then
  echo "Browser publish output was not found at $WEBROOT" >&2
  exit 1
fi
printf '\nTheMashup browser preview: port 8080. In Cloud Shell, open Web Preview → Preview on port 8080.\n'
exec python3 -m http.server 8080 --bind 0.0.0.0 --directory "$WEBROOT"
