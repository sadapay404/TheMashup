import { motion } from "framer-motion";
import { Disc3, Home, Library, Search, Download, X, Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { useUIStore, type PageId } from "../../stores/uiStore";
import { useDownloadsStore } from "../../stores/downloadsStore";
import { ThemeSwitcher } from "../ui/ThemeSwitcher";
import { api } from "../../lib/api";

const NAV: { id: PageId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "library", label: "Library", icon: Library },
  { id: "downloads", label: "Downloads", icon: Download },
];

function ApiStatusDot() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .health()
        .then(() => alive && setOk(true))
        .catch(() => alive && setOk(false));
    check();
    const t = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <span
      title={ok === null ? "Checking API…" : ok ? "API connected" : "API offline"}
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-dim"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          ok === null ? "bg-faint" : ok ? "bg-emerald-400" : "bg-red-400"
        }`}
      />
      {ok === null ? "…" : ok ? "live" : "offline"}
    </span>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const page = useUIStore((s) => s.page);
  const setPage = useUIStore((s) => s.setPage);
  const jobs = useDownloadsStore((s) => s.jobs);
  const activeDownloadCount = Object.values(jobs).filter(
    (j) => j.status === "queued" || j.status === "downloading" || j.status === "processing",
  ).length;

  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center gap-2.5 px-2 pt-1">
        <motion.span
          whileHover={{ rotate: 180 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-contrast"
        >
          <Disc3 className="h-5 w-5" />
        </motion.span>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-extrabold tracking-tight text-ink">
            TheMashup
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-faint">music ecosystem</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <motion.button
              key={item.id}
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                setPage(item.id);
                onNavigate?.();
              }}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active ? "bg-surface-2 text-ink" : "text-dim hover:bg-surface hover:text-ink"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-xl ring-1 ring-accent/50"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon className="relative h-4.5 w-4.5" />
              <span className="relative flex-1 text-left">{item.label}</span>
              {item.id === "downloads" && activeDownloadCount > 0 && (
                <span className="relative flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-contrast">
                  {activeDownloadCount}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3">
        <div className="rounded-xl border border-line bg-surface/60 p-2.5">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-faint">
              <Activity className="h-3 w-3" /> Themes
            </span>
            <ApiStatusDot />
          </div>
          <ThemeSwitcher />
        </div>
        <p className="px-2 text-[10px] leading-relaxed text-faint">
          Personal build · streams resolve locally via gateway
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  const open = useUIStore((s) => s.sidebarOpen);
  const setSidebar = useUIStore((s) => s.setSidebar);

  return (
    <>
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-bg-soft/70 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/55"
            onClick={() => setSidebar(false)}
          />
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute inset-y-0 left-0 w-[272px] border-r border-line bg-bg-soft"
          >
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setSidebar(false)}
              className="absolute right-2 top-2 rounded-lg p-2 text-dim hover:bg-surface"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent onNavigate={() => setSidebar(false)} />
          </motion.aside>
        </div>
      )}
    </>
  );
}
