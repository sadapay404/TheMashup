import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { useUIStore } from "./stores/uiStore";
import { useSessionStore } from "./stores/sessionStore";

// Ensure persisted theme is applied even when JS state rehydrates late.
const initialTheme = useUIStore.getState().theme;
document.documentElement.setAttribute("data-theme", initialTheme);

// Restore auth session (Supabase) or demo identity before first library read.
void useSessionStore.getState().init();

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
