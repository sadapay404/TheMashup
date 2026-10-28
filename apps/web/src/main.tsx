import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { useUIStore } from "./stores/uiStore";
import { useSessionStore } from "./stores/sessionStore";
import { usePlayerStore } from "./stores/playerStore";
import { onPlayerAction } from "./lib/desktop";
import { setupMediaSession } from "./lib/mediaSession";
import { isCapacitor, decideBackPress } from "./lib/mobile";
import { useConnectionStore, armNetworkWatch } from "./lib/connection";

// Ensure persisted theme is applied even when JS state rehydrates late.
const initialTheme = useUIStore.getState().theme;
document.documentElement.setAttribute("data-theme", initialTheme);

// Restore auth session (Supabase) or demo identity before first library read.
void useSessionStore.getState().init();

// Desktop shell: system media keys + tray menu → player controls.
void onPlayerAction((action) => {
  const player = usePlayerStore.getState();
  if (action === "toggle") player.toggle();
  else if (action === "next") void player.next(true);
  else if (action === "prev") void player.prev();
});

// Lock-screen / notification / headset controls (browser + Android WebView).
// GlobalThis marker makes Vite HMR re-entry replace the previous subscription.
const win = window as unknown as { __themashupMediaSession?: () => void };
win.__themashupMediaSession?.();
win.__themashupMediaSession = setupMediaSession();

// Android hardware back button: close layers → previous section → double
// press = Home. Back never force-closes the app (the system gesture does).
if (isCapacitor()) {
  void import("@capacitor/app")
    .then(async ({ App }) => {
      let lastNavigateAt: number | null = null;
      await App.addListener("backButton", () => {
        const conn = useConnectionStore.getState().status;
        // The gateway picker owns the screen — back must not navigate behind it.
        if (conn === "checking" || conn === "need-setup") return;
        const ui = useUIStore.getState();
        const now = Date.now();
        const decision = decideBackPress({
          playerExpanded: ui.playerExpanded,
          queueOpen: ui.queueOpen,
          sidebarOpen: ui.sidebarOpen,
          page: ui.page,
          historyLen: ui.pageHistory.length,
          msSinceLastNavigate: lastNavigateAt === null ? null : now - lastNavigateAt,
        });
        if (decision === "collapse-player") {
          lastNavigateAt = null;
          ui.setPlayerExpanded(false);
        } else if (decision === "close-queue") {
          lastNavigateAt = null;
          ui.setQueueOpen(false);
        } else if (decision === "close-sidebar") {
          lastNavigateAt = null;
          ui.setSidebar(false);
        } else if (decision === "navigate") {
          ui.backPage();
          lastNavigateAt = now;
        } else if (decision === "go-home") {
          ui.goHome();
          lastNavigateAt = null;
        }
        // "none": already Home with no history — stay put.
      });
    })
    .catch(() => undefined);
}

// Server connection: on Android, discover the LAN gateway (mDNS) or show the
// setup screen; everywhere, watch for network loss to surface the retry chip.
armNetworkWatch();
if (isCapacitor()) void useConnectionStore.getState().runSetup();

// Installable offline shell (production only, browsers only — never dev HMR,
// never the native WebView where it would cache stale APK assets).
if (isCapacitor()) {
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((rs) => rs.forEach((r) => void r.unregister()))
      .catch(() => undefined);
  }
} else if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
