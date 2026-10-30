# TheMashup for Windows — separate rebuild

**Status: phase W1 implementation.** The new shell uses Avalonia with a shared
Windows/browser interface, targets 64-bit Windows 10 and 11 on Intel-compatible
x64 processors, and keeps each device's library local. No Windows executable,
installer, Android build or APK is produced by this phase. Search, playback,
recommendations, library contents and downloads are not connected yet.

The new Windows app will be developed under this top-level `windows/` directory,
separately from `android/`, the legacy `desktop/` wrapper, and the existing
web/server code. Existing pending Android work must not be reset, overwritten,
staged with Windows-only changes, or compiled during this Windows work.

## Phase plan

Each implementation phase ends with a consistent phase report, exact commands
for its **actual** Google Cloud Shell preview, results/limitations, and a stop
for explicit permission before starting the next phase. Browser previews can
exercise cross-platform UI and network behavior; they cannot establish that
Windows-only APIs, media keys, system notifications, installation or desktop
performance work. Those require a Windows machine or Windows CI and must be
reported separately.

| Phase | Scope | Preview/gate |
|---|---|---|
| W1 | Project foundation, separate app shell, responsive desktop layout, navigation, accessible controls, initial theme/persistence support, browser preview infrastructure. | Run the real phase-1 UI through Cloud Shell port 8080; distinguish unfinished features from working ones. |
| W2 | Local data and core: persistent settings, five themes, likes, playlists, history, queue model, data migrations and tests. | Preview persistence and library interactions; run model/data tests. |
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

## Google Cloud Shell preview (W1)

The first setup downloads the .NET 10 SDK and the WebAssembly workload; it can
take several minutes and needs free space and internet access. It builds the
**browser head only**, not a Windows EXE. The app in the browser is the actual
shared Avalonia UI, not a separate mockup. Browser and Windows theme settings
are stored separately on their respective devices.

```bash
# Run once in a new Cloud Shell session/directory.
git clone --single-branch --branch arena/af3d0d7b-themashup \
  https://github.com/sadapay404/TheMashup.git "$HOME/TheMashup-Windows"
cd "$HOME/TheMashup-Windows/windows"

# Install the .NET 10 SDK into your Cloud Shell home directory.
curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/themashup-dotnet-install.sh
bash /tmp/themashup-dotnet-install.sh --channel 10.0 --install-dir "$HOME/.dotnet"
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$DOTNET_ROOT:$PATH"
dotnet workload install wasm-tools --skip-manifest-update

# Publish and serve the real browser preview on port 8080.
bash scripts/preview.sh
```

Choose **Web Preview → Preview on port 8080** in Cloud Shell. Stop with Ctrl+C.
To preview again in a later shell:

```bash
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$DOTNET_ROOT:$PATH"
cd "$HOME/TheMashup-Windows/windows"
bash scripts/preview.sh
```

For future approved phases, update this dedicated clone with `git pull --ff-only`
before running the preview, provided you have not made local changes there.
Do not run a hard reset against a working clone.

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
