/**
 * Settings + Diagnostics.
 *
 * The Diagnostics panel is the "one tap verifies everything" surface promised in docs/08 §10.
 * Because I could not reach YouTube from the build sandbox, this panel is how *you* confirm the
 * live behaviour — and it is honest about what each check proves.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { buildRequest, PROFILES, STREAM_LADDER } from '@themashup/core';
import { service } from '@/lib/service';
import { store, useApp } from '@/state/store';
import { snap } from '@/components/ui/primitives';
import { SparkIcon } from '@/components/ui/icons';

type CheckState = 'idle' | 'run' | 'pass' | 'fail' | 'warn';
interface CheckRow {
  id: string;
  label: string;
  detail: string;
  state: CheckState;
}

export function SettingsScreen() {
  const [checks, setChecks] = useState<CheckRow[]>([
    { id: 'direct', label: 'Direct InnerTube request', detail: 'Can this browser POST to music.youtube.com?', state: 'idle' },
    { id: 'search', label: 'Search via active route', detail: 'WEB_REMIX search for a known query', state: 'idle' },
    { id: 'visionos', label: 'VISIONOS player', detail: 'Token-free, cipher-free stream ladder rung 1', state: 'idle' },
    { id: 'tv', label: 'TVHTML5 player', detail: 'Token-free rung 2', state: 'idle' },
    { id: 'lrclib', label: 'LRCLIB lyrics', detail: 'Title/artist lookup (no lyric-body search exists upstream)', state: 'idle' },
    { id: 'storage', label: 'Persistent storage', detail: 'Can downloads survive eviction?', state: 'idle' },
  ]);
  const [running, setRunning] = useState(false);
  const transportRoute = useApp((s) => s.transportRoute);
  const amoled = useApp((s) => s.amoled);
  const cookie = service.hasAccount();

  const update = (id: string, state: CheckState, detail?: string) =>
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, state, ...(detail ? { detail } : {}) } : c)));

  const runDiagnostics = async () => {
    setRunning(true);
    setChecks((prev) => prev.map((c) => ({ ...c, state: 'run' as CheckState })));

    // 1. Direct probe
    try {
      const req = buildRequest(PROFILES.WEB_REMIX, 'search', { query: 'test' }, { hl: 'en', gl: 'US' });
      const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
      update('direct', res.ok ? 'pass' : 'fail', `HTTP ${res.status} from music.youtube.com`);
    } catch {
      update('direct', 'fail', 'Blocked by CORS — the relay ladder will be used instead');
    }

    // 2. Search through the active route
    const s = await service.search('oasis wonderwall', 'songs');
    if (s.ok) {
      const count = s.result.sections.reduce((n, sec) => n + (sec.kind === 'songs' ? sec.items.length : 0), 0);
      update('search', count > 0 ? 'pass' : 'warn', `${count} song results · ${s.route}`);
    } else {
      update('search', 'fail', s.error?.message ?? 'failed');
    }

    // 3/4. Player rungs on a stable, well-known video id
    for (const [id, profile] of [
      ['visionos', 'VISIONOS'],
      ['tv', 'TVHTML5'],
    ] as const) {
      try {
        const res = await service.innertube.player(profile, 'dQw4w9WgXcQ');
        const formats = (res.json as { streamingData?: { adaptiveFormats?: unknown[] } })?.streamingData?.adaptiveFormats;
        const n = Array.isArray(formats) ? formats.length : 0;
        const hasUrl = Array.isArray(formats) && formats.some((f) => typeof (f as { url?: string }).url === 'string');
        update(id, hasUrl ? 'pass' : n ? 'warn' : 'fail', `${n} formats, ${hasUrl ? 'direct URLs' : 'ciphered only'}`);
      } catch {
        update(id, 'fail', 'blocked from this browser — using the public API path instead');
      }
    }

    // 5. Lyrics
    const lyrics = await service.lyricsFor({ id: 'x', title: 'Wonderwall', artist: 'Oasis', durationSec: 258, thumbs: [] });
    update('lrclib', lyrics ? 'pass' : 'warn', lyrics ? `${lyrics.synced ? 'Synced' : 'Plain'} lyrics found` : 'No match');

    // 6. Storage
    const persisted = await navigator.storage?.persist?.().catch(() => false);
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    update(
      'storage',
      persisted ? 'pass' : 'warn',
      `${persisted ? 'Persistent' : 'Best-effort'} · ${estimate?.usage ? `${Math.round(estimate.usage / 1e6)} MB used` : 'unknown usage'}`,
    );

    setRunning(false);
    store.notify('Diagnostics complete', 'success');
  };

  return (
    <div className="px-4 pb-40 pt-3">
      <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-none">Settings</h1>

      <Section title="Playback">
        <Row label="Active route" value={transportRoute} />
        <Row label="Account" value={cookie ? 'Signed in (cookie)' : 'Anonymous'} />
        <Row label="Stream ladder" value={STREAM_LADDER.join(' → ')} />
      </Section>

      <Section title="Appearance">
        <Toggle
          label="True black (AMOLED)"
          value={amoled}
          onChange={(v) => {
            store.set({ amoled: v });
            document.documentElement.dataset['amoled'] = String(v);
          }}
        />
        <Row label="Accent" value="Derived from artwork" />
      </Section>

      <Section title="Diagnostics" id="diagnostics">
        <p className="mb-2 px-1 text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
          These checks run live against the real services. Nothing is sent anywhere except the requests
          themselves.
        </p>
        <div className="space-y-1.5">
          {checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 rounded-2xl bg-white/4 px-3 py-2.5">
              <StatusDot state={c.state} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{c.label}</div>
                <div className="text-[11px] leading-snug text-[var(--color-text-3)]">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          transition={snap}
          disabled={running}
          onClick={() => void runDiagnostics()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] py-3 text-[13px] font-semibold text-black disabled:opacity-60"
        >
          <SparkIcon width={17} height={17} />
          {running ? 'Running…' : 'Run diagnostics'}
        </motion.button>
      </Section>

      <Section title="About">
        <Row label="Version" value="0.4.0 · Phase 4" />
        <Row label="Server dependency" value="None" />
        <Row label="Analytics" value="None" />
        {/* Stated explicitly because it is a promise, not an implementation detail: a user who
            expects their likes to follow them to another device deserves to know they do not. */}
        <Row label="Your data" value="On this device only — likes and history never sync" />
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-[var(--color-text-3)]">
          TheMashup streams from the public YouTube Music catalogue using your own session. Downloads are for
          personal use. Lyrics come from LRCLIB. No media is hosted or redistributed by this app.
        </p>
      </Section>
    </div>
  );
}

function StatusDot({ state }: { state: CheckState }) {
  const color =
    state === 'pass'
      ? 'bg-[var(--color-ok)]'
      : state === 'fail'
        ? 'bg-[var(--color-danger)]'
        : state === 'warn'
          ? 'bg-[var(--color-warn)]'
          : state === 'run'
            ? 'bg-[var(--accent)]'
            : 'bg-white/20';
  return (
    <motion.span
      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`}
      animate={state === 'run' ? { opacity: [1, 0.25, 1] } : { opacity: 1 }}
      transition={state === 'run' ? { repeat: Infinity, duration: 1.1 } : snap}
    />
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-6">
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-3)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-1 py-2.5 last:border-0">
      <span className="text-[12.5px]">{label}</span>
      <span className="max-w-[60%] truncate text-right text-[11.5px] text-[var(--color-text-3)]">{value}</span>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-1 py-2.5">
      <span className="text-[12.5px]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full transition-colors ${value ? 'bg-[var(--accent)]' : 'bg-white/15'}`}
      >
        <motion.span
          layout
          transition={snap}
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
          style={{ left: value ? 22 : 2 }}
        />
      </button>
    </div>
  );
}
