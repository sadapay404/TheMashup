# TheMashup for Windows — separate rebuild

**Status: phase W3 development.** The Avalonia Windows/browser UI has local
playlists, likes and an explicit queue, plus a real catalog/search integration,
suggestions, lyric-line discovery and LRCLIB lyrics lookup. Playback, Home
recommendations and downloads are not connected yet. Search does not start music
or autoqueue results. The Windows managed build is a development build, not a
self-contained Windows distribution: its search host still needs Node, Python and
the installed monorepo dependencies until future packaging work. No executable,
installer, Android build or APK is produced here.

The new Windows app will be developed under this top-level `windows/` directory,
separately from `android/`, the legacy `desktop/` wrapper, and the existing
web/server code. Existing pending Android work must not be reset, overwritten,
staged with Windows-only changes, or compiled during this Windows work.

## Phase plan

Each implementation phase ends with a consistent phase report, results and
limitations, and a stop for explicit permission before starting the next phase.
The user requested postponing the next preview until it has useful music
features; provide the actual Cloud Shell commands when they request that preview. Browser previews can
exercise cross-platform UI and network behavior; they cannot establish that
Windows-only APIs, media keys, system notifications, installation or desktop
performance work. Those require a Windows machine or Windows CI and must be
reported separately.

| Phase | Scope | Preview/gate |
|---|---|---|
| W1 | Project foundation, separate app shell, responsive desktop layout, navigation, accessible controls, initial theme/persistence support, browser preview infrastructure. | Run the real phase-1 UI through Cloud Shell port 8080; distinguish unfinished features from working ones. |
| W2 | Local data and core: persistent settings, five themes, likes, playlists, history, queue model, data migrations and tests. | Playlist creation, rename and confirmed deletion work locally; test persisted models and UI. The user deferred preview until later. |
| W3 | Search, catalog and lyrics: YouTube-first extraction, Piped/Invidious fallbacks, lyric matching, suggestions, independent loading/error states. | Preview real integration where network access permits; identify any fixture mode explicitly. |
| W4 | Playback engine: audio/video, failover, seek, shuffle/repeat, end-of-track behavior, explicit manual queue semantics, desktop transport integration. | Preview supported playback; Windows media controls/tray need Windows validation. |
| W5 | One-time account connection and native Home recommendations, with Google/YouTube developer credentials not required. No separate YouTube Music listening section. | Preview supported Home flows; account authentication and security require appropriate environment/device validation. |
| W6 | Download manager: bundled FFmpeg plan, audio/video quality choices, progress, safe resume, cleanup, offline playback and conditional video section. | Preview download workflow; actual Windows file permissions, codecs and offline playback require Windows validation. |
| W7 | Full parity audit, accessibility, security, performance profiling on modest and high-end machines, regression fixes and documentation. | Exercise complete supported flows, publish measured results and all remaining limitations. |
| Packaging | Only after explicit permission: Windows packaging/signing/distribution decisions and build. | No `.exe` or installer until the user authorizes it. |

The ordering can be adjusted to honor the selected UI architecture without
removing a phase gate. A phase may expose features as unavailable until their
real implementation exists; it must not silently replace requested behavior
with a fake or stub and claim parity.

## Requirements carried into the Windows rebuild

| Requirement | Verification target |
|---|---|
| Laptop/large-screen-first, responsive to resize and scaling | Test multiple window sizes, keyboard navigation, accessibility and display scaling on Windows. |
| Low-end and high-end performance | Profile actual frame times, memory and CPU; cap caches, virtualize long lists, and respect reduced motion. Do not claim performance without measurements. |
| Native Windows app; browser preview after each phase | Share actual UI where the selected technology permits; label platform differences, and test Windows-only integrations on Windows. |
| Existing pnpm monorepo and Express + Python backend architecture | Keep existing server/web projects intact; design Windows-owned local integration and ensure final app does not require the user to start separate services manually. |
| YouTube extraction first, Piped/Invidious as fallback | Test source ordering, outages and clear errors. |
| One-time YouTube/Google connection → recommendations directly on Home | Keep playback in TheMashup, no separate listening section; no Supabase or Google developer credentials required for the connection. Never log credentials. |
| No ads inserted by TheMashup | Do not add ad components; provider behavior, availability and policy can change. |
| Search, lyric matching/synced lyrics, discovery/radio | Exercise the actual request → result → playback flow, including failure/loading states. |
| Search tap plays just that song; previous current song stays immediately behind it | Add-only queue action must add exactly that song without interrupting playback. Never autoqueue a search result list. |
| Five persistent themes | Verify each theme and persistence after restart. |
| Audio/video downloads with bundled FFmpeg, offline playback and separate conditional video section | Test saved copies, resume/cleanup, formats, file permissions and moved/deleted files. Speed is source-dependent. |
| Background play, queue, media keys, system controls and tray | Validate Windows-specific behavior on Windows, not just in the browser. |
| Separate local libraries | No automatic cross-device sync; consider optional import/export only if requested. |
| No EXE yet | Do not package/build an EXE or installer until explicitly authorized. |

## W2 storage and feature boundaries

Windows keeps themes and the versioned library separately in its local app-data
folder (`TheMashup/appearance.txt` and `TheMashup/library.json`). The browser
uses its own origin-scoped local storage; it is not synced to Windows or Android
and may disappear if browser data is cleared or a preview origin changes.
Unknown/newer or corrupt library files are left untouched and editing is disabled
rather than silently overwriting them. Save failures are reported in the UI.
Playlist deletion asks for confirmation and does not delete liked tracks. Search
can explicitly like a result, add it to a playlist, or add exactly that result
to the manual queue; none of these actions starts playback. History is recorded
only by a future playback engine, not by search or queue actions. No track is
presented as playing just because it is in a saved queue.

To reduce visual clutter the inactive player/now-playing placeholders are hidden
until there is real playback. This is a layout simplification, not a measured
performance claim; responsiveness and playback must be profiled on Windows later.

## W3 search and lyrics boundaries

- Catalog search uses the existing FastAPI resolver: YouTube Music first,
  Piped then Invidious when the preceding source fails. Suggestions are separate,
  so they do not delay catalog results. Providers can change or be unavailable.
- LRCLIB's actual index searches track/artist/album **metadata**, not arbitrary
  lines of lyrics. Lyric-line discovery instead uses Genius's unofficial public
  lyric search, then checks title and artist against the YouTube-first catalog
  before attaching a playable ID. Unmatched hits are never guessed or queued.
  Genius can change/block this unofficial endpoint and its terms apply. Search
  text is sent to the relevant catalog, suggestion and lyric-search providers.
- Lyrics for a selected result are requested from LRCLIB by metadata. Plain and
  timestamped lines can be displayed, but playback-driven highlighting is not
  implemented until the player exists. A provider outage is distinct from a
  successful empty result.
- The browser calls its own origin only. A preview host starts a search-only
  Express gateway and FastAPI resolver on loopback and proxies four read-only
  endpoints; it does not expose the monorepo's download, account or stream APIs.
  The desktop development head starts this host on demand without requiring a
  separate PC/LAN gateway or manual service startup. **Bundling and lifecycle/
  security validation of the runtimes on Windows remain future work.** Without
  their development dependencies the managed desktop build reports an error.
- CI's `MOCK_UPSTREAM=1` / `RESOLVER_MOCK=1` checks are explicitly fixture-only.
  They test behavior and wiring, not live YouTube, Genius, LRCLIB, fallback
  availability, Windows execution or performance. The user deferred the next
  preview; do not describe fixture data as live music.

## Google Cloud Shell preview (deferred)

Cloud Shell has limited persistent home storage. The preview script places
NuGet, .NET CLI data, Python virtual environment, npm/pnpm caches and build
artifacts under `/tmp` by default; it does not delete existing caches. pnpm
installs `node_modules` in the cloned source checkout, so put that clone in `/tmp`. `/tmp`
is temporary and may be cleared when the Cloud Shell VM stops. The browser
preview is the actual shared Avalonia UI, not a separate mockup. No EXE is built.

When a preview is requested, first check that `/tmp` has several gigabytes free
and that Node.js, npm and Python 3 (with `venv`) are available. The script
installs the existing API and resolver dependencies in temporary storage and
starts their local search-only host automatically. This setup installs the SDK and
its WebAssembly workload outside the home directory:

```bash
df -h "$HOME" /tmp
WORK="$(mktemp -d /tmp/themashup-windows.XXXXXX)"
mkdir -p "$WORK/tmp" "$WORK/cli-home" "$WORK/nuget"
export TMPDIR="$WORK/tmp"
export DOTNET_CLI_HOME="$WORK/cli-home"
export NUGET_PACKAGES="$WORK/nuget/packages"
export NUGET_HTTP_CACHE_PATH="$WORK/nuget/http"
export DOTNET_ROOT="$WORK/dotnet"
export PATH="$DOTNET_ROOT:$PATH"

curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$WORK/dotnet-install.sh"
bash "$WORK/dotnet-install.sh" --channel 10.0 --install-dir "$DOTNET_ROOT"
dotnet workload install wasm-tools --skip-manifest-update

git clone --single-branch --branch arena/af3d0d7b-themashup \
  https://github.com/sadapay404/TheMashup.git "$WORK/source"
cd "$WORK/source/windows"
THEMASHUP_PREVIEW_DIR="$WORK/preview" bash scripts/preview.sh
```

Select **Web Preview → Preview on port 8080**. Stop with Ctrl+C. If the VM
restarts, its temporary files may be gone and this setup must be repeated.
Do not save personal work only in `/tmp`.

If .NET 10 and `wasm-tools` are already installed in `$HOME/.dotnet`, keep
those and skip the installer/workload steps. Set `DOTNET_ROOT` and `PATH` to
that location, clone the source in `/tmp`, and run the preview as above. You
can set `THEMASHUP_PREVIEW_DIR` to a private directory with enough space to
reuse its caches during the same session. If `/tmp` is also full, inspect
`df -h "$HOME" /tmp` and `df -i "$HOME" /tmp`; do not delete user files or
reset Cloud Shell automatically.

## Preview and source safety

The Cloud Shell preview will bind port `8080`, use same-origin browser requests,
and route any backend traffic server-side; browser code must not call its own
`localhost` to reach a Cloud Shell service. Preview commands will be supplied
only for features that actually exist in the completed phase. Never expose or
paste real Google session cookies in a preview or repository.

The user approved temporarily switching `.github/workflows/android.yml` to
manual-only, so Windows-only pushes do not trigger an APK build. Do not manually
dispatch it; restore its original push trigger only when the user approves
resuming Android work. The pending, uncommitted Android changes remain local and
are not included in Windows-only commits. The Windows-specific preview workflow
compiles/tests managed code and the browser preview without producing an EXE.
