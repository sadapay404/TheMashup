import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemeId } from "@themashup/shared";
import { DEFAULT_THEME } from "@themashup/shared";

export type PageId = "home" | "search" | "library" | "downloads";

interface UIState {
  page: PageId;
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
    (set) => ({
      page: "home",
      theme: DEFAULT_THEME,
      sidebarOpen: false,
      playerExpanded: false,
      queueOpen: false,
      playerTab: "lyrics",
      visualizerOn: true,
      searchQuery: "",
      authModalOpen: false,
      downloadTrack: null,

      setPage: (page) => set({ page }),
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
