/**
 * Home. No shelf fetches upstream yet (that lands with library sync); instead it is useful from the
 * first second: continue listening, quick picks, and an honest status card when offline.
 */

import { motion } from 'framer-motion';
import type { Track } from '@themashup/core';
import { useApp } from '@/state/store';
import { EmptyState, glide, snap } from '@/components/ui/primitives';
import { MicIcon, PlayIcon, SearchIcon, SparkIcon } from '@/components/ui/icons';
import { TrackRow } from '@/components/library/TrackRow';
import { formatTime } from '@/components/ui/primitives';

export function HomeScreen({ onPlay, onGoSearch }: { onPlay: (t: Track, list: Track[]) => void; onGoSearch: () => void }) {
  const history = useApp((s) => s.history);
  const queue = useApp((s) => s.queue);
  const transportRoute = useApp((s) => s.transportRoute);

  const continueList = [...history].slice(0, 8);
  const recentQueue = queue.slice(0, 6);

  return (
    <div className="px-4 pb-40 pt-3">
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

      {continueList.length ? (
        <Section title="Continue listening">
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {continueList.map((t, i) => (
              <motion.button
                key={`${t.id}-${i}`}
                type="button"
                onClick={() => onPlay(t, continueList)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...snap, delay: i * 0.02 }}
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
      ) : null}

      {recentQueue.length ? (
        <Section title="In your queue">
          {recentQueue.map((t, i) => (
            <TrackRow key={`${t.id}-q${i}`} track={t} index={i} onPlay={() => onPlay(t, recentQueue)} />
          ))}
        </Section>
      ) : null}

      {!continueList.length && !recentQueue.length ? (
        <div className="mt-6">
          <EmptyState
            icon={<SparkIcon width={30} height={30} />}
            title="Nothing played yet"
            detail="Search for a song, or paste a lyric you remember. Everything you play shows up here and teaches the on-device recommender."
            action={{ label: 'Find something to play', onClick: onGoSearch }}
          />
          <div className="mx-auto mt-2 max-w-sm rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_3%,transparent)] p-3 text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
            <strong className="text-[var(--color-text-2)]">Zero server:</strong> search, streaming, lyrics and
            downloads all run in this tab. There is no account, no backend, and no analytics.
          </div>
        </div>
      ) : null}

      {queue.length ? (
        <div className="mt-6 rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_3%,transparent)] p-3 text-[11.5px] text-[var(--color-text-3)]">
          Queue · {queue.length} tracks ·{' '}
          {formatTime(queue.reduce((n, t) => n + t.durationSec, 0))} total
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
