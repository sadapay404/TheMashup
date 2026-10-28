/**
 * First-launch / recovery screen for the native shell.
 *
 * Shown when no gateway can be reached (mDNS discovery + stored address +
 * emulator alias all failed). Offers a LAN scan retry, a manual address
 * field, and an emulator shortcut. Rendered as a full-screen overlay from
 * App.tsx only while `status === "need-setup"`.
 */
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Server, WifiOff } from "lucide-react";
import { useConnectionStore } from "../../lib/connection";

export function ConnectionScreen() {
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const connectManual = useConnectionStore((s) => s.connectManual);
  const retry = useConnectionStore((s) => s.retry);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const checking = status === "checking";

  // Auto-scan once when the screen mounts (covers cold-start need-setup).
  useEffect(() => {
    if (status === "need-setup") void retry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      await connectManual(value);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#0a0a0f] px-6 text-zinc-100">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <Server size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Connect to TheMashup</h1>
            <p className="text-xs text-zinc-400">
              Your gateway runs on your computer — the phone joins it over Wi‑Fi.
            </p>
          </div>
        </div>

        {checking ? (
          <div className="flex items-center gap-2 rounded-lg bg-black/30 px-4 py-3 text-sm text-zinc-300">
            <Loader2 size={16} className="animate-spin" />
            Scanning this network for the gateway…
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-950/50 px-3 py-2 text-xs text-red-200">
              <WifiOff size={14} className="mt-0.5 shrink-0" />
              <span>{error ?? "Gateway unreachable."}</span>
            </div>

            <label className="mb-1.5 block text-xs font-medium text-zinc-400" htmlFor="gw-addr">
              Gateway address (PC’s LAN IP)
            </label>
            <input
              id="gw-addr"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void connect();
              }}
              placeholder="e.g. 192.168.1.20  or  192.168.1.20:4000"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mb-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-accent"
            />

            <div className="flex gap-2">
              <button
                onClick={() => void connect()}
                disabled={busy || !value.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition disabled:opacity-40"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : null}
                Connect
              </button>
              <button
                onClick={() => void retry()}
                disabled={checking}
                className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
                title="Scan the network again"
              >
                <RefreshCw size={15} /> Scan
              </button>
            </div>

            <button
              onClick={() => {
                setValue("10.0.2.2");
              }}
              className="mt-3 w-full rounded-lg px-2 py-1.5 text-xs text-zinc-500 underline-offset-2 transition hover:text-zinc-300 hover:underline"
            >
              Running in the Android emulator? Use 10.0.2.2
            </button>
          </>
        )}
      </div>

      <p className="mt-6 max-w-sm text-center text-[11px] leading-relaxed text-zinc-600">
        Start the gateway on your computer with <code className="text-zinc-400">pnpm dev</code>,
        make sure the phone and computer are on the same Wi‑Fi, then tap Scan.
        The first run needs your PC’s IP because mDNS discovery can be blocked
        by some routers.
      </p>
    </div>
  );
}

/** Small floating chip while previously-working requests start failing. */
export function ConnectionLostChip() {
  const lost = useConnectionStore((s) => s.lost);
  const retry = useConnectionStore((s) => s.retry);
  const status = useConnectionStore((s) => s.status);
  if (!lost || status !== "ready") return null;
  return (
    <button
      onClick={() => void retry()}
      className="fixed bottom-24 right-4 z-[85] flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-950/95 px-4 py-2 text-xs font-semibold text-amber-100 shadow-xl backdrop-blur transition hover:bg-amber-900/95"
      role="status"
    >
      <WifiOff size={13} />
      Gateway lost — tap to reconnect
    </button>
  );
}
