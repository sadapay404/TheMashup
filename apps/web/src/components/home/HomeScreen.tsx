/**
 * Home.
 *
 * One rule divides Home from Library: **history and queue live in Library; Home proposes what to
 * play next.** Re-listing what you already played makes the first screen a museum instead of a
 * suggestion, and it is the single most common way a music app feels empty.
 *
 *   - Signed in to a Google account → recommendations, seeded from what you have actually played.
 *   - Not signed in            → the empty state, honestly explaining why there is nothing here
 *                                rather than showing invented content.
 *
 * The search affordance stays on Home in both cases: it is the one thing a music app must never
 * make you hunt for.
 */

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { Track } from '@themashup/core';
import { useApp } from '@/state/store';
import { EmptyState, glide, snap } from '@/components/ui/primitives';
import { MicIcon, PlayIcon, SearchIcon, SparkIcon } from '@/components/ui/icons';
import { useContentBottom } from '@/hooks/useContentBottom';
import { screenTop } from '@/lib/layout';
import { useHomeFeed } from '@/hooks/useHomeFeed';
import { service } from '@/lib/service';

export function HomeScreen({ onPlay, onGoSearch }: { onPlay: (t: Track, list: Track[]) => void; onGoSearch: () => void }) {
  const paddingBottom = useContentBottom();
  const transportRoute = useApp((s) => s.transportRoute);

  // `hasAccount` reads an in-memory cookie, so it has to be sampled after mount; on the native
  // build the sign-in sheet can also finish long after Home first rendered.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedIn(service.hasAccount());
    const onFocus = () => setSignedIn(service.hasAccount());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const { shelves, loading, origin } = useHomeFeed(signedIn);

  return (
    <div className="px-4" style={{ paddingBottom, paddingTop: screenTop() }}>
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={glide}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[34px] leading-none tracking-tight">TheMashup</h1>
            <p className="mt-1 text-[12px] text-[var(--color-text-3)]">
              {transportRoute === 'detecting'
                ? 'Detecting the best route…'
                : transportRoute === 'direct'
                  ? 'Connected directly'
                  : `Via ${transportRoute}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onGoSearch}
            aria-label="Search the catalogue"
            className="grid h-12 w-12 place-items-center rounded-full bg-[color-mix(in_oklab,var(--wash)_7%,transparent)] transition hover:bg-[color-mix(in_oklab,var(--wash)_11%,transparent)]"
          >
            <SearchIcon width={21} height={21} />
          </button>
        </div>
      </motion.header>

      {/* Lyric search hero — the signature feature, one tap away */}
      <motion.button
        type="button"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...glide, delay: 0.05 }}
        whileTap={{ scale: 0.985 }}
        onClick={onGoSearch}
        className="mt-5 flex w-full items-center gap-3 overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] bg-gradient-to-br from-[var(--accent)]/22 via-white/4 to-transparent p-4 text-left"
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/20">
          <MicIcon width={20} height={20} className="text-[var(--accent)]" />
        </div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold">Remember a lyric, not the title?</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-text-2)]">
            Type the words. It matches on-device, even offline.
          </div>
        </div>
      </motion.button>

      {/*
        The shelves.

        Each one is a row YouTube named. The titles are rendered as returned — "Quick picks",
        "Listen again", "Mixed for you", whatever the account's home page happens to say today —
        rather than mapped onto a fixed set, so a rename upstream changes a heading instead of
        silently emptying the page.

        Order is YouTube's, not ours. Its ranking knows more about this account than any local
        heuristic, and that ordering is a large part of why its home page feels right.
      */}
      {signedIn ? (
        shelves.length ? (
          shelves.map((shelf, si) => (
            <Section key={`${shelf.title}-${si}`} title={shelf.title}>
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                {shelf.tracks.map((t, i) => (
                  <motion.button
                    key={`${t.id}-s${si}-${i}`}
                    type="button"
                    onClick={() => onPlay(t, shelf.tracks)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...snap, delay: Math.min(i, 5) * 0.018 }}
                    whileTap={{ scale: 0.96 }}
                    className="w-[136px] shrink-0 text-left"
                  >
                    <div className="relative aspect-square overflow-hidden rounded-2xl bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
                      {t.thumbs[0] ? (
                        <img src={t.thumbs[0].url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-2xl text-[var(--color-text-3)]">♪</div>
                      )}
                      <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 backdrop-blur">
                        <PlayIcon width={14} height={14} />
                      </span>
                    </div>
                    <div className="mt-2 truncate text-[12.5px] font-medium">{t.title}</div>
                    <div className="truncate text-[11px] text-[var(--color-text-3)]">{t.artist}</div>
                  </motion.button>
                ))}
              </div>
            </Section>
          ))
        ) : (
          <Section title="For you">
            {/*
              Loading and "nothing yet" get different copy, and so does *which* source produced
              nothing. A spinner on a shelf that will end up empty is the most common lie a home
              screen tells.
            */}
            <div className="rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_3%,transparent)] p-4 text-[12px] leading-relaxed text-[var(--color-text-3)]">
              {loading
                ? 'Reading your YT Music home…'
                : origin === 'none'
                  ? 'YT Music has no home feed for this account yet. Play a few songs on music.youtube.com and this fills with the same rows you see there.'
                  : 'No suggestions right now.'}
            </div>
          </Section>
        )
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={<SparkIcon width={30} height={30} />}
            title="Nothing to suggest yet"
            detail="Recommendations come from your YT Music account, so the app can show the same rows you see there instead of guessing. Everything already on this device is in Library."
            action={{ label: 'Find something to play', onClick: onGoSearch }}
          />
        </div>
      )}

      {!signedIn ? (
        <div className="mx-auto mt-2 max-w-sm rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_3%,transparent)] p-3 text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
          <strong className="text-[var(--color-text-2)]">Sign in from Settings</strong> to turn this into a
          home screen that knows what you like. Nothing about your listening leaves the device: the
          account is only used to ask for suggestions.
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-3)]">
        {title}
      </h2>
      {children}
    </section>
  );
}
