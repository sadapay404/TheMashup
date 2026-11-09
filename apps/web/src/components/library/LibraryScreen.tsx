/**
 * Library: history, downloads, and a storage dashboard.
 * Downloads show their real pipeline state (queued, resolving, downloading, muxing, done, failed or
 * partial) rather than pretending a file was written when it was not.
 */

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { Track } from '@themashup/core';
import { useApp } from '@/state/store';
import { EmptyState, glide, snap } from '@/components/ui/primitives';
import { DownloadIcon, HeartIcon, LibraryIcon, TrashIcon } from '@/components/ui/icons';
import { TrackRow } from '@/components/library/TrackRow';

type Tab = 'history' | 'likes' | 'downloads';

export function LibraryScreen({ onPlay }: { onPlay: (t: Track, list: Track[]) => void }) {
  const [tab, setTab] = useState<Tab>('history');
  const history = useApp((s) => s.history);
  const downloads = useApp((s) => s.downloads);
  const likes = useApp((s) => s.likes);

  const totalMinutes = Math.round(history.reduce((n, t) => n + t.durationSec, 0) / 60);

  return (
    <div className="px-4 pb-[var(--content-bottom)] pt-3">
      <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-none">Library</h1>
      <p className="mt-1 text-[12px] text-[var(--color-text-3)]">
        {history.length} tracks · {totalMinutes} min · stored on this device only
      </p>

      <div className="mt-4 flex gap-1 rounded-full bg-[color-mix(in_oklab,var(--wash)_6%,transparent)] p-1">
        {(
          [
            ['history', 'History'],
            ['likes', 'Likes'],
            ['downloads', 'Downloads'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="relative flex-1 rounded-full px-3 py-2 text-[12.5px] font-semibold"
          >
            {tab === id ? (
              <motion.span layoutId="lib-tab" className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--wash)_11%,transparent)]" transition={snap} />
            ) : null}
            <span className={tab === id ? 'relative z-10' : 'relative z-10 text-[var(--color-text-3)]'}>{label}</span>
          </button>
        ))}
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={glide} className="mt-4">
        {tab === 'likes' ? (
          likes.length ? (
            likes.map((t, i) => <TrackRow key={`${t.id}-l${i}`} track={t} index={i} onPlay={() => onPlay(t, likes)} />)
          ) : (
            <EmptyState
              icon={<HeartIcon width={30} height={30} />}
              title="Nothing liked yet"
              detail="Tap the heart on any track. Likes are stored on this device and feed the on-device recommender."
            />
          )
        ) : tab === 'history' ? (
          history.length ? (
            history.map((t, i) => <TrackRow key={`${t.id}-h${i}`} track={t} index={i} onPlay={() => onPlay(t, history)} />)
          ) : (
            <EmptyState
              icon={<LibraryIcon width={30} height={30} />}
              title="Your history is empty"
              detail="Tracks you play are remembered here (and only here) to power resume, recommendations and lyric search."
            />
          )
        ) : downloads.length ? (
          <div className="space-y-1.5">
            {downloads.map((j, i) => (
              <motion.div
                key={j.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...snap, delay: i * 0.02 }}
                className="flex items-center gap-3 rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] px-3 py-2.5"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
                  <DownloadIcon width={16} height={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{j.track.title}</div>
                  <div className="truncate text-[11px] text-[var(--color-text-3)]">
                    {j.target} · {j.state}
                    {j.state === 'queued' ? ' · queued for the download service' : ''}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-text-3)]">
                  {j.state}
                </span>
              </motion.div>
            ))}
            <div className="mt-3 flex items-start gap-2 rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_3%,transparent)] p-3 text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
              <TrashIcon width={15} height={15} className="mt-0.5 shrink-0" />
              <span>
                In the browser, files are written with the File System Access API where available, otherwise saved
                through the normal download path. Full multi-threaded, resumable downloading with FFmpeg remux/mux
                runs natively in the Android build.
              </span>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<DownloadIcon width={30} height={30} />}
            title="No downloads yet"
            detail="Open any track, tap Download, and pick a real quality tier — every option tells you exactly what it does."
          />
        )}
      </motion.div>
    </div>
  );
}
