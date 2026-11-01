"use client";
import { useEffect, useState } from "react";
import { THEMES } from "@/lib/themes";
import { api, post } from "@/lib/api";
import { Card, Icon, SectionTitle } from "./ui";
import { EQ_PRESETS, useApp } from "./app-context";
import { usePlayer } from "./player-context";

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline px-4 py-3.5 last:border-0">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-semibold">{title}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-7 w-12 rounded-full transition ${on ? "bg-accent" : "bg-raised border border-outline"}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full transition-all ${on ? "left-6 bg-accent-ink" : "left-1 bg-muted"}`} />
    </button>
  );
}

export function SettingsView() {
  const { settings, update, signedIn, accountName, setAccount, toast } = useApp();
  const { setSleep, sleepEnd } = usePlayer();
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!sleepEnd) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [sleepEnd]);
  const left = sleepEnd ? Math.max(0, Math.ceil((sleepEnd - Date.now()) / 60000)) : 0;

  const signIn = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const r = await post<{ signedIn: boolean; name?: string }>("/api/account", { cookie });
      setAccount(r.signedIn, r.name);
      setCookie("");
      toast("Signed in");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>

      <SectionTitle>Appearance</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {THEMES.map((t) => {
          const on = settings.theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => update({ theme: t.id })}
              aria-pressed={on}
              className={`overflow-hidden rounded-2xl border-2 text-left transition ${on ? "scale-[1.02]" : "opacity-90 hover:opacity-100"}`}
              style={{ background: t.bg, borderColor: on ? t.accent : t.outline, color: t.text }}
            >
              <div className="relative h-20" style={{ background: t.surface }}>
                <div className="absolute left-3 top-3 h-3 w-16 rounded-full" style={{ background: t.text, opacity: 0.8 }} />
                <div className="absolute left-3 top-8 h-2 w-10 rounded-full" style={{ background: t.muted }} />
                <div className="absolute bottom-3 left-3 flex gap-1.5">
                  <span className="h-5 w-5 rounded-full" style={{ background: t.accent }} />
                  <span className="h-5 w-5 rounded-full" style={{ background: t.accent2 }} />
                  <span className="h-5 w-5 rounded-full border" style={{ background: t.raised, borderColor: t.outline }} />
                </div>
                {on && (
                  <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full" style={{ background: t.accent, color: t.accentText }}>
                    <Icon name="check" size={16} />
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-bold">{t.name}</p>
                <p className="text-xs" style={{ color: t.muted }}>{t.tagline}</p>
              </div>
            </button>
          );
        })}
      </div>

      <SectionTitle>Playback</SectionTitle>
      <Card>
        <Row title="Gapless playback" hint="Pre-buffers the next track so songs flow without a pause.">
          <Toggle label="Gapless" on={settings.gapless} onChange={(v) => update({ gapless: v })} />
        </Row>
        <Row title={`Crossfade · ${settings.crossfade === 0 ? "off" : `${settings.crossfade}s`}`} hint="Overlap the end of a track with the start of the next (needs gapless).">
          <input type="range" min={0} max={12} step={1} value={settings.crossfade} onChange={(e) => update({ crossfade: Number(e.target.value) })} className="w-40 accent-[var(--accent)]" aria-label="Crossfade seconds" />
        </Row>
        <Row title={`Playback speed · ${settings.rate.toFixed(2)}×`}>
          <input type="range" min={0.5} max={2} step={0.25} value={settings.rate} onChange={(e) => update({ rate: Number(e.target.value) })} className="w-40 accent-[var(--accent)]" aria-label="Playback speed" />
        </Row>
        <Row title="Loudness normalization" hint="Evens out volume between tracks by trimming peaks.">
          <Toggle label="Normalization" on={settings.normalize} onChange={(v) => update({ normalize: v })} />
        </Row>
        {settings.normalize && (
          <Row title={`Normalization strength · ${settings.normStrength}%`}>
            <input type="range" min={0} max={100} step={5} value={settings.normStrength} onChange={(e) => update({ normStrength: Number(e.target.value) })} className="w-40 accent-[var(--accent)]" aria-label="Normalization strength" />
          </Row>
        )}
        <Row title="Equalizer preset" hint="Saved with your settings. Audio processing is applied by the native apps.">
          <div className="flex max-w-xs flex-wrap justify-end gap-1.5">
            {EQ_PRESETS.map((p) => (
              <button key={p} onClick={() => update({ eq: p })} className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${settings.eq === p ? "border-accent bg-accent text-accent-ink" : "border-outline text-muted hover:text-text"}`}>
                {p.replace("-", " ")}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Sleep timer" hint={sleepEnd ? `Pausing in about ${left} min` : "Pause playback after a set time."}>
          <select
            value={sleepEnd ? "running" : "0"}
            onChange={(e) => e.target.value !== "running" && setSleep(Number(e.target.value))}
            className="rounded-xl border border-outline bg-raised px-3 py-2 text-sm text-text outline-none"
            aria-label="Sleep timer"
          >
            {sleepEnd && <option value="running">{left} min left</option>}
            {[0, 5, 10, 15, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>{m === 0 ? "Off" : `${m} min`}</option>
            ))}
          </select>
        </Row>
      </Card>

      <SectionTitle>Account</SectionTitle>
      <Card className="p-4">
        {signedIn ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Signed in to YouTube Music</p>
              <p className="text-sm text-muted">{accountName ?? "Session verified"} · home shows recommendation shelves.</p>
            </div>
            <button
              onClick={async () => {
                await api("/api/account", { method: "DELETE" });
                setAccount(false);
                toast("Signed out");
              }}
              className="rounded-full border border-outline px-4 py-2 text-sm font-semibold hover:border-accent"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div>
            <p className="font-semibold">Sign in to YouTube Music</p>
            <p className="mt-1 text-sm text-muted">
              The web edition can&apos;t open Google&apos;s login inside the page. Sign in at music.youtube.com, open DevTools → Network, copy the <code>cookie</code> request header from any request, and paste it here. The Android app does this with a built-in WebView sign-in.
            </p>
            <textarea value={cookie} onChange={(e) => setCookie(e.target.value)} rows={3} placeholder="SID=…; SAPISID=…; __Secure-3PAPISID=…" className="mt-3 w-full rounded-xl border border-outline bg-raised px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-subtle focus:border-accent" />
            {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
            <button disabled={busy || !cookie.trim()} onClick={() => void signIn()} className="mt-3 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink disabled:opacity-40">
              {busy ? "Verifying…" : "Verify & save"}
            </button>
          </div>
        )}
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card className="p-4 text-sm text-muted">
        TheMashup resolves public catalog sources (Piped / Invidious mirrors, with a 30s preview failover), keeps your library on your own device and database, and has native Android and Windows apps in the <code>android/</code> and <code>windows/</code> folders.
      </Card>
    </div>
  );
}
