/**
 * Server connection manager (Android fix cycle).
 *
 * On a physical device the baked-in emulator host (10.0.2.2) never answers,
 * so on first launch we discover the LAN gateway via mDNS
 * (`_themashup._tcp`, advertised by the Express server) and fall back to a
 * manual address screen. The chosen base is persisted per WebView origin and
 * swapped into `api.ts` at runtime. A network-watch chip appears when
 * requests start failing so the user can re-run discovery without restarting.
 *
 * Disabled entirely when VITE_API_BASE is baked in (build-time override).
 */
import { create } from "zustand";
import { isCapacitor } from "./bridge";
import { setApiBase, getApiBase, onNetworkChange } from "./api";

export const SERVER_KEY = "themashup.server";

/** Bare host, host:port or URL → normalized origin (default port 4000). */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const u = new URL(withScheme);
    // Reject empty hosts and scheme-only artifacts ("http://", "http:", …).
    if (!u.hostname || /\s/.test(u.hostname) || /^https?$/i.test(u.hostname)) return null;
    if (!u.port) u.port = u.protocol === "https:" ? "443" : "4000";
    return u.origin;
  } catch {
    return null;
  }
}

/** Reachability probe against GET <base>/api/health. */
export async function probeServer(base: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

function hostBracket(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** Ask Android's NsdManager for `_themashup._tcp` advertisers on the LAN. */
export async function discoverServers(timeoutMs = 4000): Promise<string[]> {
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const disc = registerPlugin<{
      discover(o: { serviceType: string; timeoutMs: number }): Promise<{
        hosts: Array<{ host: string; port: number }>;
      }>;
    }>("NsdDiscovery");
    const { hosts } = await disc.discover({ serviceType: "_themashup._tcp.", timeoutMs });
    return hosts.map((h) => `http://${hostBracket(h.host)}:${h.port}`);
  } catch {
    return [];
  }
}

export type ConnectionStatus = "idle" | "checking" | "ready" | "need-setup";

interface ConnectionState {
  status: ConnectionStatus;
  /** Set when a manual entry or full setup attempt fails. */
  error: string | null;
  /** Requests are failing although we previously had a working base. */
  lost: boolean;
  runSetup: () => Promise<void>;
  connectManual: (input: string) => Promise<boolean>;
  retry: () => Promise<void>;
}

function bakedBase(): string | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE ? env.VITE_API_BASE.replace(/\/$/, "") : null;
}

export const useConnectionStore = create<ConnectionState>()((set, get) => ({
  status: "idle",
  error: null,
  lost: false,

  runSetup: async () => {
    const baked = bakedBase();
    if (baked) {
      setApiBase(baked);
      set({ status: "ready", error: null });
      return;
    }
    if (get().status === "checking") return;
    set({ status: "checking", error: null });

    const stored = localStorage.getItem(SERVER_KEY);

    // 1) Whatever currently works (same-origin on web, last choice, baked default).
    const current = getApiBase();
    if (await probeServer(current)) {
      setApiBase(current);
      set({ status: "ready", error: null, lost: false });
      return;
    }

    // 2) Persisted address.
    if (stored && stored !== current && (await probeServer(stored))) {
      setApiBase(stored);
      set({ status: "ready", error: null, lost: false });
      return;
    }

    // 3) mDNS discovery (native only) → probe every advertiser in parallel.
    const candidates = isCapacitor() ? await discoverServers() : [];
    const probes = await Promise.all(
      candidates.map(async (c) => ((await probeServer(c, 3000)) ? c : null)),
    );
    const hit = probes.find((c): c is string => c !== null);
    if (hit) {
      localStorage.setItem(SERVER_KEY, hit);
      setApiBase(hit);
      set({ status: "ready", error: null, lost: false });
      return;
    }

    // 4) Emulator loopback alias — always worth one quick try.
    if (isCapacitor() && (await probeServer("http://10.0.2.2:4000", 1500))) {
      setApiBase("http://10.0.2.2:4000");
      set({ status: "ready", error: null, lost: false });
      return;
    }

    set({
      status: "need-setup",
      error: "No TheMashup gateway found on this network.",
      lost: false,
    });
  },

  connectManual: async (input: string) => {
    const normalized = normalizeServerUrl(input);
    if (!normalized) {
      set({ error: "Enter a valid address, e.g. 192.168.1.20 or http://192.168.1.20:4000" });
      return false;
    }
    set({ status: "checking", error: null });
    if (await probeServer(normalized)) {
      localStorage.setItem(SERVER_KEY, normalized);
      setApiBase(normalized);
      set({ status: "ready", error: null, lost: false });
      return true;
    }
    set({ status: "need-setup", error: `Could not reach ${normalized}` });
    return false;
  },

  retry: async () => {
    await get().runSetup();
  },
}));

/** Network-loss chip wiring — call once from main.tsx. */
export function armNetworkWatch(): () => void {
  return onNetworkChange((down) => {
    const s = useConnectionStore.getState();
    if (down) {
      if (s.status === "ready") setApiLoss(true);
    } else if (s.lost) {
      setApiLoss(false);
      void useConnectionStore.getState().runSetup();
    }
  });
}

export function setApiLoss(down: boolean): void {
  const s = useConnectionStore.getState();
  if (s.lost !== down) useConnectionStore.setState({ lost: down });
}
