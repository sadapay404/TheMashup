import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { AppShell } from "./components/shell/AppShell";
import { HomePage } from "./components/home/HomePage";
import { DownloadsPage } from "./components/downloads/DownloadsPage";
import { QualityPicker } from "./components/downloads/QualityPicker";
import { SearchPage } from "./components/search/SearchPage";
import { LibraryPage } from "./components/library/LibraryPage";
import { SignInModal } from "./components/auth/SignInModal";
import { useSessionStore } from "./stores/sessionStore";
import { useLibraryStore } from "./stores/libraryStore";
import { ExpandedPlayer } from "./components/player/ExpandedPlayer";
import { QueueDrawer } from "./components/player/QueueDrawer";
import { useUIStore } from "./stores/uiStore";
import { usePlayerStore } from "./stores/playerStore";
import { useDownloadsStore } from "./stores/downloadsStore";
import { applyArtworkAccent } from "./lib/colors";

function ErrorToast() {
  const error = usePlayerStore((s) => (s.status === "error" ? s.error : undefined));
  const status = usePlayerStore((s) => s.status);

  useEffect(() => {
    if (status !== "error") return;
    const t = setTimeout(() => {
      if (usePlayerStore.getState().status === "error") {
        usePlayerStore.setState({ status: "paused" });
      }
    }, 6000);
    return () => clearTimeout(t);
  }, [status, error]);

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -14, scale: 0.97 }}
          className="fixed left-1/2 top-4 z-[80] max-w-[92vw] -translate-x-1/2 rounded-full border border-red-400/40 bg-red-950/90 px-5 py-2.5 text-sm text-red-100 shadow-xl backdrop-blur"
          role="alert"
        >
          {error}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const page = useUIStore((s) => s.page);
  const expanded = useUIStore((s) => s.playerExpanded);
  const artwork = usePlayerStore((s) => s.current?.artwork_best ?? s.current?.artwork);
  const currentId = usePlayerStore((s) => s.current?.id);
  const rootRef = useRef<HTMLDivElement>(null);
  const sessionMode = useSessionStore((s) => s.mode);

  // App-wide --art-1/--art-2 sampling so glows & visualizer follow the album.
  useEffect(() => {
    void applyArtworkAccent(rootRef.current, artwork, currentId);
  }, [artwork, currentId]);

  // (Re)load the library whenever the identity changes (sign-in/out).
  useEffect(() => {
    void useLibraryStore.getState().hydrate(true);
  }, [sessionMode]);

  // Download progress streams only while identified (identity rides the headers).
  useEffect(() => {
    const d = useDownloadsStore.getState();
    if (sessionMode !== "none") d.ensureStream();
    else d.stopStream();
    return () => d.stopStream();
  }, [sessionMode]);

  return (
    <ErrorBoundary>
      <div ref={rootRef} className="h-full">
        <AppShell>
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {/* Route-level boundaries: a broken page never blanks the shell. */}
              {page === "home" && (
                <ErrorBoundary key="home">
                  <HomePage />
                </ErrorBoundary>
              )}
              {page === "search" && (
                <ErrorBoundary key="search">
                  <SearchPage />
                </ErrorBoundary>
              )}
              {page === "library" && (
                <ErrorBoundary key="library">
                  <LibraryPage />
                </ErrorBoundary>
              )}
              {page === "downloads" && (
                <ErrorBoundary key="downloads">
                  <DownloadsPage />
                </ErrorBoundary>
              )}
            </motion.div>
          </AnimatePresence>
        </AppShell>

        <QueueDrawer />
        <AnimatePresence>{expanded && <ExpandedPlayer />}</AnimatePresence>
        <QualityPicker />
        <SignInModal />
        <ErrorToast />
      </div>
    </ErrorBoundary>
  );
}
