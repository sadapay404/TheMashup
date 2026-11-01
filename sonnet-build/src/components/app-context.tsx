"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Playlist, RepeatMode, ThemeId, Track } from "@/lib/types";
import { DEFAULT_THEME, THEMES } from "@/lib/themes";
import { api, post } from "@/lib/api";

export type Settings = {
  theme: ThemeId;
  crossfade: number;
  gapless: boolean;
  normalize: boolean;
  normStrength: number;
  rate: number;
  eq: string;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
};

export const EQ_PRESETS = ["off", "flat", "bass-boost", "vocal", "treble", "rock", "electronic"] as const;

const DEFAULTS: Settings = {
  theme: DEFAULT_THEME,
  crossfade: 3,
  gapless: true,
  normalize: false,
  normStrength: 50,
  rate: 1,
  eq: "flat",
  volume: 0.9,
  repeat: "off",
  shuffle: false,
};

export type View = "home" | "search" | "library" | "downloads" | "settings";

type Ctx = {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  view: View;
  setView: (v: View) => void;
  searchSeed: string;
  searchFor: (q: string) => void;
  liked: Track[];
  likedIds: Set<string>;
  toggleLike: (t: Track) => Promise<void>;
  playlists: Playlist[];
  history: Track[];
  refreshLibrary: () => Promise<void>;
  createPlaylist: (name: string) => Promise<Playlist | null>;
  playlistTarget: Track | null;
  pickPlaylist: (t: Track | null) => void;
  addToPlaylist: (id: number, t: Track) => Promise<void>;
  toast: (msg: string) => void;
  toastMsg: string | null;
  signedIn: boolean;
  accountName?: string;
  setAccount: (signedIn: boolean, name?: string) => void;
};

const C = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(C);
  if (!c) throw new Error("AppProvider missing");
  return c;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>("home");
  const [searchSeed, setSeed] = useState("");
  const [liked, setLiked] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [history, setHistory] = useState<Track[]>([]);
  const [playlistTarget, pickPlaylist] = useState<Track | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [accountName, setAccountName] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mashup.settings");
      if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("mashup.settings", JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
    const t = THEMES.find((x) => x.id === settings.theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t?.bg ?? "#0A0A0F");
  }, [settings, loaded]);

  const update = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const [l, p, h] = await Promise.all([
        api<Track[]>("/api/liked"),
        api<Playlist[]>("/api/playlists"),
        api<Track[]>("/api/history"),
      ]);
      setLiked(l);
      setPlaylists(p);
      setHistory(h);
    } catch {
      /* offline: keep stale */
    }
  }, []);

  useEffect(() => {
    void refreshLibrary();
    api<{ signedIn: boolean; name?: string }>("/api/account")
      .then((a) => {
        setSignedIn(a.signedIn);
        setAccountName(a.name);
      })
      .catch(() => {});
  }, [refreshLibrary]);

  const likedIds = useMemo(() => new Set(liked.map((t) => t.id)), [liked]);

  const toggleLike = useCallback(
    async (t: Track) => {
      try {
        const r = await post<{ liked: boolean }>("/api/liked", t);
        toast(r.liked ? "Added to Liked Songs" : "Removed from Liked Songs");
        await refreshLibrary();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Failed");
      }
    },
    [refreshLibrary, toast],
  );

  const createPlaylist = useCallback(
    async (name: string) => {
      try {
        const p = await post<Playlist>("/api/playlists", { name });
        await refreshLibrary();
        return p;
      } catch {
        toast("Could not create playlist");
        return null;
      }
    },
    [refreshLibrary, toast],
  );

  const addToPlaylist = useCallback(
    async (id: number, t: Track) => {
      try {
        const r = await post<{ duplicate: boolean }>(`/api/playlists/${id}`, t);
        toast(r.duplicate ? "Already in playlist" : "Added to playlist");
        await refreshLibrary();
      } catch {
        toast("Could not add to playlist");
      }
    },
    [refreshLibrary, toast],
  );

  const value: Ctx = {
    settings,
    update,
    view,
    setView,
    searchSeed,
    searchFor: (q) => {
      setSeed(q);
      setView("search");
    },
    liked,
    likedIds,
    toggleLike,
    playlists,
    history,
    refreshLibrary,
    createPlaylist,
    playlistTarget,
    pickPlaylist,
    addToPlaylist,
    toast,
    toastMsg,
    signedIn,
    accountName,
    setAccount: (s, n) => {
      setSignedIn(s);
      setAccountName(n);
    },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
