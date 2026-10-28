# TheMashup — Desktop (Tauri, Phase 7)

The desktop shell is the Phase-6 web app wrapped in Tauri v2 (WebView2 on
Windows) with the native bits from the blueprint:

- **Media keys** — `MediaPlayPause` / `MediaNext` / `MediaPrev` registered via
  `tauri-plugin-global-shortcut` (plus `Ctrl+Alt+P` / `Ctrl+Alt+→` / `Ctrl+Alt+←`
  fallbacks that work on every platform).
- **Tray menu** — Show player · Play/Pause · Previous · Next · Quit (left-click
  the tray icon toggles the window).
- **Native save dialogs** — the Downloads page's **Save** button opens a real
  file dialog (`tauri-plugin-dialog`) and writes the finished job's bytes to the
  chosen path (`tauri-plugin-fs`, scoped to `$HOME`, `$DOWNLOAD`, `$DESKTOP`,
  `$TEMP`).
- The web build/PWA stays untouched — everything here degrades to no-ops in a
  regular browser.

## Layout

```
desktop/
└── src-tauri/
    ├── Cargo.toml            Rust deps (tauri 2 + dialog/fs/global-shortcut)
    ├── tauri.conf.json       window, CSP, bundle icons, dev/build commands
    ├── capabilities/default.json
    ├── icons/                full icon set (generated from the vinyl PNG)
    └── src/main.rs           tray + media shortcuts → `player-action` events
```

The window reuses `apps/web` verbatim: in dev it loads the Vite server
(`:8080`, `/api` proxied like always); in a packaged build it loads the static
bundle and talks to the gateway at `http://127.0.0.1:4000` directly (CORS
allows the Tauri origins; `VITE_API_BASE` overrides the gateway host).

## Prerequisites (Windows 10/11)

1. **Node 20+** and pnpm 9: https://nodejs.org → `corepack enable`
2. **Rust (MSVC toolchain)**: https://rustup.rs → run `rustup-init.exe`
   (accept the MSVC default; install "C++ build tools" if prompted)
3. **WebView2 Runtime** — preinstalled on Windows 10/11
4. WebView2 dev tools only if you want remote debugging (optional)

> Linux dev also needs `webkit2gtk-4.1` + `librsvg` (see
> <https://v2.tauri.app/start/prerequisites/>).

## Click-by-click build

```bat
:: 1. workspace + resolver (one time)
pnpm setup

:: 2. backends for development (terminal A)
pnpm dev

:: 3. desktop dev loop with hot reload (terminal B)
pnpm desktop:dev
```

`desktop:dev` runs `tauri dev`, which starts the Vite server itself
(`beforeDevCommand`) and opens the native window against `:8080`.

**Package a release:**

```bat
pnpm desktop:build
```

Outputs land in `desktop/src-tauri/target/release/bundle/`:

| Kind | Path |
|---|---|
| MSI / NSIS installer | `…/bundle/msi/*.msi`, `…/bundle/nsis/*-setup.exe` |
| Bare exe | `…/release/themashup.exe` |

## Runtime expectations

- The gateway (:4000) + resolver (:8000) must be running (`pnpm dev`) — the
  desktop app is a shell over the same local backend the web UI uses.
- In a packaged build the window origin is `tauri://localhost` /
  `http://tauri.localhost`; API calls go to `http://127.0.0.1:4000` (see
  `API_BASE` in `apps/web/src/lib/api.ts`).
- Media keys and tray actions arrive in the page as `player-action` events
  (`apps/web/src/lib/desktop.ts` → `playerStore`).

## Not covered (honest limits)

- **Taskbar thumbnail buttons** (Windows jumplists) have no Tauri API — use the
  tray menu or media keys instead.
- The sandbox used for development has no Rust toolchain/crates.io access, so
  compilation happens on the target machine with the steps above; everything
  config- and JS-side (CLI, icons, capabilities schema, CORS, bridge tests) is
  verified here.
