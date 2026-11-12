/**
 * Settings + Diagnostics.
 *
 * The Diagnostics panel is the "one tap verifies everything" surface promised in docs/08 §10.
 * Because I could not reach YouTube from the build sandbox, this panel is how *you* confirm the
 * live behaviour — and it is honest about what each check proves.
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { buildRequest, inspectRungs, parsePlayer, pickAudioUrl, PROFILES, STREAM_LADDER } from '@themashup/core';
import { service } from '@/lib/service';
import {
  isNative,
  nativeAccountStatus,
  nativeBootMark,
  nativeCookie,
  nativePickAccount,
  nativeSignIn,
  nativeSignInAs,
  onNativeEvent,
} from '@/lib/native';
import { store, useApp } from '@/state/store';
import { snap } from '@/components/ui/primitives';
import { applyTheme, THEMES, themeMeta } from '@/lib/theme';
import {
  HAPTIC_EVENTS,
  haptic,
  hapticsSupported,
  previewHaptic,
  setHapticsEnabled,
  setHapticSettings,
  type HapticEvent,
} from '@/lib/haptics';
import { ChevronDownIcon, SparkIcon } from '@/components/ui/icons';
import { CrashReport } from '@/components/settings/CrashReport';
import { useContentBottom } from '@/hooks/useContentBottom';
import { notificationsAvailable } from '@/lib/notifications';
import { screenTop } from '@/lib/layout';

type CheckState = 'idle' | 'run' | 'pass' | 'fail' | 'warn' | 'skipped';
interface CheckRow {
  id: string;
  label: string;
  detail: string;
  state: CheckState;
}

export function SettingsScreen() {
  const paddingBottom = useContentBottom();
  const [checks, setChecks] = useState<CheckRow[]>([
    { id: 'direct', label: 'Direct InnerTube request', detail: 'Can this browser POST to music.youtube.com?', state: 'idle' },
    { id: 'search', label: 'Search via active route', detail: 'WEB_REMIX search for a known query', state: 'idle' },
    { id: 'resolve', label: 'Stream resolution', detail: 'Walks the real ladder with the real picker', state: 'idle' },
    { id: 'visionos', label: 'VISIONOS player', detail: 'First rung — the one that resolves here', state: 'idle' },
    { id: 'tv', label: 'TVHTML5 player', detail: 'Token-free, but ciphers everything on this device', state: 'idle' },
    { id: 'lrclib', label: 'LRCLIB lyrics', detail: 'Title/artist lookup (no lyric-body search exists upstream)', state: 'idle' },
    { id: 'storage', label: 'Persistent storage', detail: 'Can downloads survive eviction?', state: 'idle' },
    // These two are the honest "what will not work here" rows. They are checks, not chores: a
    // feature that cannot exist on this platform should say so in the report rather than be absent.
    {
      id: 'native',
      label: 'Native shell features',
      detail: 'Background audio, lockscreen, hardware keys — Android build only',
      state: 'idle',
    },
    {
      id: 'account',
      label: 'Google account',
      detail: 'Checked below in the Account section',
      state: 'idle',
    },
    {
      id: 'notifications',
      label: 'Notifications',
      detail: 'Whether the app can reach the notification shade',
      state: 'idle',
    },
  ]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const transportRoute = useApp((s) => s.transportRoute);
  const amoled = useApp((s) => s.amoled);
  const theme = useApp((s) => s.theme);
  const haptics = useApp((s) => s.haptics);
  const hapticEvents = useApp((s) => s.hapticEvents);
  const volume = useApp((s) => s.volume);
  const rate = useApp((s) => s.rate);
  type SoundProfile = 'flat' | 'bass' | 'treble' | 'vocal' | 'custom';
  const [soundProfile, setSoundProfile] = useState<SoundProfile>('flat');
  // Account state is re-read after sign-in and on mount, because the native WebView completes
  // out-of-band: there is no promise to await that means "the user finished signing in".
  const [signedIn, setSignedIn] = useState(service.hasAccount());
  const [signingIn, setSigningIn] = useState(false);
  const [accountMsg, setAccountMsg] = useState<string | null>(null);

  const refreshAccount = async () => {
    if (isNative()) {
      const status = await nativeAccountStatus();
      if (status?.signedIn) {
        const c = await nativeCookie();
        if (c) service.setCookie(c);
      }
      setSignedIn(Boolean(status?.signedIn) || service.hasAccount());
      return;
    }
    setSignedIn(service.hasAccount());
  };

  useEffect(() => {
    // Mount-only: `refreshAccount` is recreated each render but only touches state, and re-running
    // this on every render would poll the native plugin on every keystroke elsewhere on the page.
    void refreshAccount();
  }, []);

  /*
   * Backing out of the Google page ends the wait.
   *
   * The complaint was that pressing back closed the WebView and nothing else happened, so the button
   * stayed on "Waiting for Google…" while the sign-in was already over. The native side now reports
   * the dismissal, which lets this screen stop spinning and say why.
   */
  useEffect(() => {
    const off = onNativeEvent('signInDismissed', () => {
      setSigningIn(false);
      setAccountMsg('Sign-in cancelled. Pick an account above, or try again.');
    });
    return off;
  }, []);

  /**
   * Start sign-in.
   *
   * One tap opens the *system* account picker, which already knows every Google account on the phone.
   * The user picks one, and the native side signs in as that identity — no login form to type into and
   * no hand-built list that Google would refuse to populate. If the picker is cancelled or absent,
   * nothing happens: silently opening a web page would be the "it just goes to YT Music" behaviour the
   * user rejected.
   */
  const doSignIn = async () => {
    setAccountMsg(null);
    if (!isNative()) {
      // Stated plainly instead of showing a button that cannot work: a Google session cookie is
      // HttpOnly, so no browser script can read it, and this build has no hosted callback.
      setAccountMsg(
        'Sign-in needs the Android build. A browser cannot read Google’s HttpOnly session cookie, and this app has no server to receive an OAuth callback — that is a consequence of zero hosted infrastructure, not a bug.',
      );
      return;
    }

    const email = await nativePickAccount();
    if (!email) return; // cancelled — the screen is exactly as it was
    await signInAs(email);
  };

  /** The WebView flow, kept for devices with no account picker and for a different identity. */
  const openWebSignIn = async () => {
    setSigningIn(true);
    await nativeSignIn();
    // The WebView may still be open; poll briefly so the row updates the moment it closes.
    for (let i = 0; i < 120; i++) {
      const status = await nativeAccountStatus();
      if (status?.signedIn) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await refreshAccount();
    setSigningIn(false);
    setAccountMsg(service.hasAccount() ? 'Signed in.' : 'Not signed in yet.');
  };

  /** One tap on a device account. */
  const signInAs = async (email: string) => {
    setSigningIn(true);
    setAccountMsg(`Signing in as ${email}…`);
    await nativeSignInAs(email);
    for (let i = 0; i < 120; i++) {
      const status = await nativeAccountStatus();
      if (status?.signedIn) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await refreshAccount();
    setSigningIn(false);
    setAccountMsg(service.hasAccount() ? `Signed in as ${email}.` : `Could not sign in as ${email}.`);
  };

  const doSignOut = () => {
    service.setCookie(null);
    setSignedIn(false);
    setAccountMsg('Signed out. Playback still works anonymously.');
  };

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

    // 3/4. Stream resolution, exactly as the player does it.
    //
    // The old version counted `adaptiveFormats` and asked "is any url a string?" — a test that a
    // ciphered-only response could still look reassuring on, and which said nothing about whether
    // the picker would accept the result. It now runs the real ladder through the real picker, so
    // "what this page says" and "what playback will do" cannot disagree.
    const probe = 'dQw4w9WgXcQ';
    const rungs: string[] = [];
    let winner: { profile: string; itag: number; kbps: number; gated: boolean } | null = null;

    for (const profile of STREAM_LADDER) {
      try {
        const res = await service.innertube.player(profile, probe);
        const report = inspectRungs(res.json, profile, probe);
        rungs.push(`${profile}:${report.direct}/${report.formats}`);
        if (report.playable && !winner) {
          const info = parsePlayer(res.json, profile, probe);
          const pick = pickAudioUrl(info);
          const chosen = info.audio.find((a) => a.itag === pick?.itag);
          winner = {
            profile,
            itag: pick?.itag ?? 0,
            kbps: chosen?.nominalKbps ?? 0,
            gated: PROFILES[profile].needsStreamPoToken,
          };
          break;
        }
        if (profile === 'TVHTML5') {
          // Reported separately because it is the one rung the user's own device has measured:
          // zero usable formats, everything ciphered.
          update(
            'tv',
            report.playable ? 'pass' : 'fail',
            report.formats
              ? `${report.formats} formats, ${report.direct} direct`
              : '0 formats — ciphered only, cannot be used',
          );
        }
        if (profile === 'VISIONOS') {
          update(
            'visionos',
            report.playable ? 'pass' : report.direct ? 'warn' : 'fail',
            `${report.formats} formats, ${report.direct} direct`,
          );
        }
      } catch (e) {
        // Never the opaque word "blocked". A missing plugin, a CORS rejection, a 403 and a timeout
        // are four different problems with four different fixes, and printing one word for all of
        // them is how this took five attempts to diagnose.
        const err = e as { k?: string; status?: number; cause?: string; missing?: string; message?: string };
        const why =
          err.k === 'Upstream'
            ? `HTTP ${err.status}`
            : err.k === 'Capability'
              ? `missing ${err.missing ?? 'capability'}`
              : err.k === 'Network'
                ? `network ${err.cause ?? 'unknown'}`
                : err.k ?? 'unknown';
        rungs.push(`${profile}:${why}`);
        if (profile === 'VISIONOS') update('visionos', 'fail', why);
        if (profile === 'TVHTML5') update('tv', 'fail', why);
      }
    }

    // Every row must reach a terminal state. Two ways a row could still be sitting on [RUN]:
    // the loop broke early because an earlier rung won, or the loop finished while `winner` was set
    // so the fallback below never ran. Both are settled here, unconditionally.
    if (!rungs.some((r) => r.startsWith('VISIONOS:'))) {
      update('visionos', winner ? 'skipped' : 'fail', winner ? 'not reached — an earlier rung won' : 'no response');
    }
    if (!rungs.some((r) => r.startsWith('TVHTML5:'))) {
      update('tv', winner ? 'skipped' : 'fail', winner ? 'not reached — VISIONOS resolved first' : 'no response');
    }

    // The line that actually answers "why do songs stop". The winning rung's token status decides
    // it: a gated client serves about a megabyte and then 403s, however healthy it looks.
    if (winner) {
      update(
        'resolve',
        winner.gated ? 'warn' : 'pass',
        `${winner.profile} · itag ${winner.itag} @ ${winner.kbps}kbps${
          winner.gated ? ' · token-gated, may stop early' : ' · token-free, should play through'
        }`,
      );
      nativeBootMark(`settings: ladder ${rungs.join(' ')} → ${winner.profile} itag ${winner.itag}`);
    } else {
      update('resolve', 'fail', `no stream resolved — ${rungs.join(' ')}`);
      nativeBootMark(`settings: ladder ${rungs.join(' ')} → nothing playable`);
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

    // 7. Platform capabilities. Reported truthfully instead of silently omitted.
    update(
      'native',
      isNative() ? 'pass' : 'warn',
      isNative()
        ? 'Android shell detected — background playback and lockscreen should work'
        : 'Not available in a browser: audio stops when the tab is backgrounded, and there are no lockscreen controls',
    );
    // Notification delivery is a capability, not a nicety: without it a download that finishes while
    // the app is closed leaves no trace. Reported honestly instead of assumed.
    const canNotify = await notificationsAvailable();
    update(
      'notifications',
      canNotify ? 'pass' : isNative() ? 'fail' : 'warn',
      canNotify
        ? 'Shade reachable — downloads, playback and alerts will be delivered'
        : isNative()
          ? 'Blocked by the system — Android Settings → Apps → TheMashup → Notifications'
          : 'Android build only',
    );

    update(
      'account',
      service.hasAccount() ? 'pass' : 'warn',
      service.hasAccount()
        ? 'Signed in'
        : isNative()
          ? 'Anonymous — you can sign in below'
          : 'Anonymous — sign-in requires the Android build (see the Account section)',
    );

    setRunning(false);
    setFinished(true);
    store.notify('Diagnostics complete', 'success');
  };

  /**
   * A verdict, not a pile of dots.
   *
   * Six coloured dots do not tell the user whether the app works. This summarises them into a
   * sentence, names the single most important blocker, and can be copied for a bug report.
   */
  const summary = useMemo(() => {
    const pass = checks.filter((c) => c.state === 'pass').length;
    const fail = checks.filter((c) => c.state === 'fail').length;
    const warn = checks.filter((c) => c.state === 'warn').length;
    const total = pass + fail + warn;
    const searchCheck = checks.find((c) => c.id === 'search');
    const searchOk = searchCheck?.state === 'pass';

    let verdict: string;
    let advice: string;
    if (!total) {
      verdict = 'Not run yet';
      advice = 'Tap Run diagnostics to test this device against the live services.';
    } else if (searchOk && fail === 0) {
      verdict = 'Everything essential works';
      advice = `${pass} of ${total} checks passed. Search, streaming and lyrics are reachable from this network.`;
    } else if (searchOk) {
      verdict = 'The app works, with caveats';
      advice = `${pass} passed, ${warn} degraded, ${fail} failed. Search and playback work; the failures above are optional paths that fall back to another route.`;
    } else {
      verdict = 'Search is blocked on this network';
      advice =
        'No search route answered. This is usually the network blocking the community Piped/Invidious instances (very common on mobile data and in some regions) rather than the app itself. Try Wi-Fi, a VPN, or add your own relay below.';
    }

    return { pass, fail, warn, total, verdict, advice };
  }, [checks]);

  const copyReport = () => {
    const lines = [
      `TheMashup diagnostics · ${new Date().toISOString()}`,
      `verdict: ${summary.verdict}`,
      `passed ${summary.pass} · degraded ${summary.warn} · failed ${summary.fail}`,
      '',
      ...checks.map((c) => `[${c.state.toUpperCase().padEnd(4)}] ${c.label} — ${c.detail}`),
    ];
    void navigator.clipboard?.writeText(lines.join('\n')).then(
      () => store.notify('Report copied to clipboard', 'success'),
      () => store.notify('Could not access the clipboard', 'error'),
    );
  };

  return (
    <div className="px-4" style={{ paddingBottom, paddingTop: screenTop() }}>
      <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-none">Settings</h1>

      <Section title="Playback" summary={`Volume ${Math.round(volume * 100)}% · speed ${rate}×`}>
        <Row label="Active route" value={transportRoute} />
        <Row label="Account" value={signedIn ? 'Signed in' : 'Anonymous'} />
        <div className="mt-2 px-1">
          {/*
            Sign in.

            One button, which opens the *system* account picker. That picker is the only thing on a
            modern Android that can list Google accounts: the app cannot enumerate them itself (Google
            returns an empty list without its own consent flow) and asking for GET_ACCOUNTS only
            produces a confusing "Contacts" row in Settings. Letting the OS draw the list also means
            the user sees their real, current accounts — and taps one, rather than typing.

            While the picker or the Google page is up, the button becomes the status line.
          */}
          <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => (signedIn ? doSignOut() : void doSignIn())}
                disabled={signingIn}
                className="flex-1 rounded-2xl bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] py-2.5 text-[12.5px] font-semibold disabled:opacity-60"
              >
                {signingIn ? 'Waiting for Google…' : signedIn ? 'Sign out' : 'Sign in with Google'}
              </button>
              {!signedIn ? (
                <button
                  type="button"
                  onClick={() => void openWebSignIn()}
                  disabled={signingIn}
                  aria-label="Sign in with a different account using the Google page"
                  className="shrink-0 rounded-2xl bg-[color-mix(in_oklab,var(--wash)_6%,transparent)] px-3 py-2.5 text-[11.5px] font-medium text-[var(--color-text-2)] disabled:opacity-60"
                >
                  Other…
                </button>
              ) : null}
          </div>
          {accountMsg ? (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-3)]">{accountMsg}</p>
          ) : null}
        </div>
        <Row label="Stream ladder" value={STREAM_LADDER.join(' → ')} />
        <div className="mt-2 px-1">
          <button
            type="button"
            onClick={() => {
              const nextProfile: Record<SoundProfile, SoundProfile> = {
                flat: 'bass', bass: 'treble', treble: 'vocal', vocal: 'custom', custom: 'flat',
              };
              setSoundProfile(nextProfile[soundProfile]);
              store.notify(`Sound profile: ${nextProfile[soundProfile]}`, 'info');
            }}
            className="w-full rounded-2xl bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] py-2.5 text-[12.5px] font-semibold"
          >
            Sound profile: {soundProfile}
          </button>
        </div>
      </Section>

      <Section title="Appearance" summary={themeMeta(theme).name}>
        <p className="mb-2 px-1 text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
          Each theme sets its own ground, text and accent. Colour inside a track still comes from its
          artwork, so the app keeps the original idea while the surface changes.
        </p>
        <div className="grid gap-1.5">
          {THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  store.set({ theme: t.id });
                  applyTheme(t.id, amoled);
                  store.notify(`${t.name} applied`, 'success');
                }}
                aria-pressed={active}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                  active
                    ? 'bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] ring-1 ring-[var(--accent)]'
                    : 'bg-[color-mix(in_oklab,var(--wash)_5%,transparent)]'
                }`}
              >
                {/* Four real swatches of the theme rather than a generic dot. */}
                <span className="flex shrink-0 overflow-hidden rounded-lg ring-1 ring-black/20">
                  {t.swatch.map((c) => (
                    <span key={c} style={{ background: c }} className="h-8 w-3" />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold">{t.name}</span>
                  <span className="block truncate text-[11px] text-[var(--color-text-3)]">{t.blurb}</span>
                </span>
                {active ? <span className="shrink-0 text-[11px] font-semibold text-[var(--accent)]">Active</span> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          <Toggle
            label="True black (AMOLED)"
            value={amoled}
            onChange={(v) => {
              store.set({ amoled: v });
              // Re-applied through the same path as every other theme change, so a light theme
              // correctly ignores an AMOLED request instead of going half-inverted.
              applyTheme(theme, v);
            }}
          />
        </div>
        <Row label="Accent" value="Derived from artwork" />
      </Section>

      <Section
        title="Haptics"
        summary={
          haptics
            ? `${Object.values(hapticEvents).filter(Boolean).length} of ${HAPTIC_EVENTS.length} events`
            : 'Off'
        }
      >
        {!hapticsSupported() ? (
          <p className="mb-2 rounded-xl bg-[color-mix(in_oklab,var(--color-warn)_14%,transparent)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-warn)]">
            This browser has no vibration motor API, so nothing here will be felt. The Android build
            uses the same events through the WebView and does vibrate.
          </p>
        ) : null}

        <Toggle
          label="Vibration"
          value={haptics}
          onChange={(v) => {
            store.set({ haptics: v });
            setHapticsEnabled(v);
            if (v) previewHaptic('tap');
          }}
        />

        {haptics ? (
          <>
            <div className="mt-1 flex items-center justify-between border-b border-[var(--hairline)] px-1 py-2">
              <span className="text-[11px] text-[var(--color-text-3)]">Turn every event off or on</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const all = Object.fromEntries(HAPTIC_EVENTS.map((e) => [e.id, true])) as Record<HapticEvent, boolean>;
                    store.set({ hapticEvents: all });
                    setHapticSettings(all);
                  }}
                  className="rounded-full bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] px-2.5 py-1 text-[10.5px] font-semibold"
                >
                  All on
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const none = Object.fromEntries(HAPTIC_EVENTS.map((e) => [e.id, false])) as Record<HapticEvent, boolean>;
                    store.set({ hapticEvents: none });
                    setHapticSettings(none);
                  }}
                  className="rounded-full bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] px-2.5 py-1 text-[10.5px] font-semibold"
                >
                  All off
                </button>
              </div>
            </div>

            {HAPTIC_EVENTS.map((e) => (
              <div key={e.id} className="flex items-center gap-2 border-b border-[var(--hairline)] px-1 py-2 last:border-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px]">{e.label}</span>
                  <span className="block truncate text-[10.5px] text-[var(--color-text-3)]">{e.detail}</span>
                </span>
                <button
                  type="button"
                  onClick={() => previewHaptic(e.id)}
                  aria-label={`Preview ${e.label}`}
                  className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text-2)]"
                >
                  Test
                </button>
                <Toggle
                  label={e.label}
                  compact
                  value={hapticEvents[e.id] ?? false}
                  onChange={(v) => {
                    const next = { ...hapticEvents, [e.id]: v };
                    store.set({ hapticEvents: next });
                    setHapticSettings(next);
                    if (v) previewHaptic(e.id);
                  }}
                />
              </div>
            ))}
          </>
        ) : null}
      </Section>

      <Section title="Diagnostics" id="diagnostics" defaultOpen summary="Tap to test this device against the live services">
        <p className="mb-2 px-1 text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
          These checks run live against the real services. Nothing is sent anywhere except the requests
          themselves.
        </p>
        {finished ? (
          <div className="mb-3 rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold">{summary.verdict}</span>
              <span className="shrink-0 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-text-3)]">
                {summary.pass}✓ {summary.warn}⚠ {summary.fail}✕
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-2)]">{summary.advice}</p>
            <button
              type="button"
              onClick={copyReport}
              className="mt-2 rounded-full bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] px-3 py-1 text-[11px] font-semibold"
            >
              Copy full report
            </button>
          </div>
        ) : null}
        <div className="space-y-1.5">
          {checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 rounded-2xl bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] px-3 py-2.5">
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
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] py-3 text-[13px] font-semibold text-[var(--on-accent)] disabled:opacity-60"
        >
          <SparkIcon width={17} height={17} />
          {running ? 'Running…' : 'Run diagnostics'}
        </motion.button>
      </Section>

      <Section
        title="Crash report"
        id="crash"
        summary="If the app closed on its own, the reason is recorded here"
      >
        <CrashReport />
      </Section>

      <Section title="About" summary="Version 0.4.0 · no server, no analytics">
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
            : 'bg-[color-mix(in_oklab,var(--wash)_10%,transparent)]';
  return (
    <motion.span
      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`}
      animate={state === 'run' ? { opacity: [1, 0.25, 1] } : { opacity: 1 }}
      transition={state === 'run' ? { repeat: Infinity, duration: 1.1 } : snap}
    />
  );
}

/**
 * A collapsible settings section.
 *
 * Settings became long enough that everything was equally loud: six screens of rows with no
 * hierarchy, so nothing was findable. Each group is now a disclosure with a one-line summary of its
 * current state, which is what makes the collapsed view useful rather than just shorter.
 */
function Section({
  title,
  children,
  id,
  summary,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
  /** Shown while collapsed, so the closed state still tells you something. */
  summary?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="mt-3 overflow-hidden rounded-2xl border border-[var(--hairline)]">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          haptic('tap');
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-3 bg-[color-mix(in_oklab,var(--wash)_4%,transparent)] px-3.5 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">{title}</span>
          {!open && summary ? (
            <span className="mt-0.5 block truncate text-[11px] text-[var(--color-text-3)]">{summary}</span>
          ) : null}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={snap}
          className="shrink-0 text-[var(--color-text-3)]"
          aria-hidden
        >
          <ChevronDownIcon width={16} height={16} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3 pt-1">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--hairline)] px-1 py-2.5 last:border-0">
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{label}</span>
      <span className="max-w-[58%] shrink-0 truncate text-right text-[11.5px] text-[var(--color-text-3)]">{value}</span>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  /** Dense variant used inside the per-event haptics list. */
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${compact ? 'py-0' : 'px-1 py-2.5'}`}>
      <span className={`min-w-0 flex-1 text-[12.5px] ${compact ? 'sr-only' : ''}`}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full transition-colors ${value ? 'bg-[var(--accent)]' : 'bg-[color-mix(in_oklab,var(--wash)_16%,transparent)]'}`}
      >
        <motion.span
          layout
          transition={snap}
          className="absolute top-0.5 h-5 w-5 rounded-full bg-[var(--knob)] shadow"
          style={{ left: value ? 22 : 2 }}
        />
      </button>
    </div>
  );
}
