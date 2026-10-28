import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemeId } from "@themashup/shared";
import { DEFAULT_THEME } from "@themashup/shared";

export type PageId = "home" | "search" | "library" | "downloads";

interface UIState {
  page: PageId;
  /** Section history for the Android back button (in-memory only). */
  pageHistory: PageId[];
  theme: ThemeId;
  sidebarOpen: boolean;
  playerExpanded: boolean;
  queueOpen: boolean;
  /** Which tab the expanded player shows on small screens. */
  playerTab: "lyrics" | "queue";
  visualizerOn: boolean;
  /** Shared between header search bar and the Search page. */
  searchQuery: string;
  authModalOpen: boolean;
  /** Phase 5: quality-picker modal target (null = closed) */
  downloadTrack: import("@themashup/shared").Track | null;

  setPage: (page: PageId) => void;
  /** Android back: previous section, or false when history is empty. */
  backPage: () => boolean;
  /** Jump to Home and clear section history (double back press). */
  goHome: () => void;
  setTheme: (theme: ThemeId) => void;
  setSidebar: (open: boolean) => void;
  setPlayerExpanded: (open: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  setPlayerTab: (tab: "lyrics" | "queue") => void;
  toggleVisualizer: () => void;
  setSearchQuery: (q: string) => void;
  setAuthModalOpen: (open: boolean) => void;
  setDownloadTrack: (t: import("@themashup/shared").Track | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      page: "home",
      pageHistory: [],
      theme: DEFAULT_THEME,
      sidebarOpen: false,
      playerExpanded: false,
      queueOpen: false,
      playerTab: "lyrics",
      visualizerOn: true,
      searchQuery: "",
      authModalOpen: false,
      downloadTrack: null,

      setPage: (page) =>
        set((s) =>
          page === s.page
            ? {}
            : { page, pageHistory: [...s.pageHistory, s.page].slice(-30) },
        ),
      backPage: () => {
        const { pageHistory } = get();
        if (pageHistory.length === 0) return false;
        const prev = pageHistory[pageHistory.length - 1]!;
        set({ page: prev, pageHistory: pageHistory.slice(0, -1) });
        return true;
      },
      goHome: () => set({ page: "home", pageHistory: [] }),
      setTheme: (theme) => {
        set({ theme });
        document.documentElement?.setAttribute("data-theme", theme);
      },
      setSidebar: (sidebarOpen) => set({ sidebarOpen }),
      setPlayerExpanded: (playerExpanded) => set({ playerExpanded }),
      setQueueOpen: (queueOpen) => set({ queueOpen }),
      setPlayerTab: (playerTab) => set({ playerTab }),
      toggleVisualizer: () => set((s) => ({ visualizerOn: !s.visualizerOn })),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setAuthModalOpen: (authModalOpen) => set({ authModalOpen }),
      setDownloadTrack: (downloadTrack) => set({ downloadTrack }),
    }),
    {
      name: "themashup.ui",
      partialize: (s) => ({
        page: s.page,
        theme: s.theme,
        playerTab: s.playerTab,
        visualizerOn: s.visualizerOn,
      }),
    },
  ),
);
