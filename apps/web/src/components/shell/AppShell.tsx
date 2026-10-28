import type { ReactNode } from "react";
import { Menu, Radio, Sparkles, Library, Download } from "lucide-react";
import { motion } from "framer-motion";
import { useUIStore } from "../../stores/uiStore";
import { Sidebar } from "./Sidebar";
import { PlayerBar } from "../player/PlayerBar";
import { SearchBar } from "../search/SearchBar";
import { AuthArea } from "./AuthArea";

const PAGE_TITLES: Record<string, { title: string; icon: typeof Radio; blurb: string }> = {
  home: { title: "Home", icon: Sparkles, blurb: "Picks tuned by what you play" },
  search: { title: "Search", icon: Radio, blurb: "Songs, artists & lyric lookup" },
  library: { title: "Library", icon: Library, blurb: "Likes, playlists & history" },
  downloads: { title: "Downloads", icon: Download, blurb: "MP3 · FLAC · MP4 in every quality" },
};

export function AppShell({ children }: { children: ReactNode }) {
  const page = useUIStore((s) => s.page);
  const setSidebar = useUIStore((s) => s.setSidebar);
  const meta = PAGE_TITLES[page] ?? PAGE_TITLES.home;
  const PageIcon = meta.icon;

  return (
    <div className="flex h-full overflow-hidden bg-bg text-ink">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur-xl lg:px-8">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setSidebar(true)}
            className="rounded-lg p-2 text-dim transition hover:bg-surface hover:text-ink lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <motion.div
            key={page}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="hidden min-w-0 items-center gap-2.5 md:flex"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <PageIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-bold leading-none tracking-tight">
                {meta.title}
              </h1>
              <p className="hidden truncate text-xs text-faint lg:block">{meta.blurb}</p>
            </div>
          </motion.div>

          <div className="min-w-0 flex-1 md:mx-4 md:max-w-xl">
            <SearchBar />
          </div>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <AuthArea />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-36 pt-5 lg:px-8">{children}</div>

        <PlayerBar />
      </main>
    </div>
  );
}
