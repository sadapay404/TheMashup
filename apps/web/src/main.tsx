import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { useUIStore } from "./stores/uiStore";
import { useSessionStore } from "./stores/sessionStore";
import { usePlayerStore } from "./stores/playerStore";
import { onPlayerAction } from "./lib/desktop";
import { setupMediaSession } from "./lib/mediaSession";
import { isCapacitor, resolveBackAction } from "./lib/mobile";

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

// Android hardware back button: collapse player → close queue/sidebar → exit.
if (isCapacitor()) {
  void import("@capacitor/app")
    .then(async ({ App }) => {
      await App.addListener("backButton", () => {
        const ui = useUIStore.getState();
        const action = resolveBackAction({
          playerExpanded: ui.playerExpanded,
          queueOpen: ui.queueOpen,
          sidebarOpen: ui.sidebarOpen,
        });
        if (action === "collapse-player") ui.setPlayerExpanded(false);
        else if (action === "close-queue") ui.setQueueOpen(false);
        else if (action === "close-sidebar") ui.setSidebar(false);
        else void App.exitApp();
      });
    })
    .catch(() => undefined);
}

// Installable offline shell (production only — never intercepts dev HMR).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
