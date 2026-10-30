#!/usr/bin/env bash
set -euo pipefail

# The browser head is the only thing published here: no Windows EXE or Android build.
# All restore and build output lives in temporary storage, not in the source tree
# or the limited Cloud Shell home partition. To reuse/relocate it, set
# THEMASHUP_PREVIEW_DIR to a directory you own.
WINDOWS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WINDOWS_DIR"

if [[ $# -gt 1 ]] || { [[ $# -eq 1 ]] && [[ "$1" != "--build-only" ]]; }; then
  echo 'Usage: bash scripts/preview.sh [--build-only]' >&2
  exit 2
fi
if ! command -v dotnet >/dev/null 2>&1; then
  echo 'The .NET 10 SDK is required. See windows/README.md.' >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3 is required to serve the browser preview.' >&2
  exit 1
fi

PREVIEW_DIR="${THEMASHUP_PREVIEW_DIR:-/tmp/themashup-windows-preview-$(id -u)}"
if [[ -L "$PREVIEW_DIR" ]]; then
  echo "Preview directory must not be a symbolic link: $PREVIEW_DIR" >&2
  exit 1
fi
if [[ -e "$PREVIEW_DIR" ]] && { [[ ! -d "$PREVIEW_DIR" ]] || [[ ! -O "$PREVIEW_DIR" ]]; }; then
  echo "Preview directory must be owned by you: $PREVIEW_DIR" >&2
  exit 1
fi
umask 077
mkdir -p -m 700 -- "$PREVIEW_DIR"
PREVIEW_DIR="$(cd "$PREVIEW_DIR" && pwd -P)"
mkdir -p -- "$PREVIEW_DIR"/{tmp,dotnet-home,nuget/packages,nuget/http,nuget/plugins,xdg-cache,xdg-config,xdg-data,artifacts}
export TMPDIR="$PREVIEW_DIR/tmp"
export DOTNET_CLI_HOME="$PREVIEW_DIR/dotnet-home"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1
export NUGET_PACKAGES="$PREVIEW_DIR/nuget/packages"
export NUGET_HTTP_CACHE_PATH="$PREVIEW_DIR/nuget/http"
export NUGET_PLUGINS_CACHE_PATH="$PREVIEW_DIR/nuget/plugins"
export XDG_CACHE_HOME="$PREVIEW_DIR/xdg-cache"
export XDG_CONFIG_HOME="$PREVIEW_DIR/xdg-config"
export XDG_DATA_HOME="$PREVIEW_DIR/xdg-data"

printf 'Preview caches and build files: %s\n' "$PREVIEW_DIR"
dotnet publish src/TheMashup.Browser/TheMashup.Browser.csproj -c Release --nologo \
  --artifacts-path "$PREVIEW_DIR/artifacts"

PUBLISH_DIR="$PREVIEW_DIR/artifacts/publish/TheMashup.Browser"
WEBROOT_INDEX=""
if [[ -d "$PUBLISH_DIR" ]]; then
  WEBROOT_INDEX="$(find "$PUBLISH_DIR" -type f -path '*/wwwroot/index.html' -print -quit)"
fi
if [[ -z "$WEBROOT_INDEX" ]]; then
  echo "Browser publish output was not found under $PUBLISH_DIR" >&2
  exit 1
fi
WEBROOT="${WEBROOT_INDEX%/index.html}"
printf '%s\n' "$WEBROOT" > "$PREVIEW_DIR/webroot.path"
if [[ "${1:-}" == "--build-only" ]]; then
  printf 'Browser preview published at %s\n' "$WEBROOT"
  exit 0
fi

printf '\nTheMashup browser preview: port 8080. In Cloud Shell, open Web Preview → Preview on port 8080.\n'
exec python3 -m http.server 8080 --bind 0.0.0.0 --directory "$WEBROOT"
