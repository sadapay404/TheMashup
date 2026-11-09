/**
 * Library: history and likes.
 *
 * Downloads used to live here as a third tab and moved to their own destination when it grew folders
 * and file management; keeping a second, weaker copy of that list here would have meant two places
 * that disagree about what is stored.
 */

import { motion } from 'framer-motion';
import { useState } from 'react';
import type { Track } from '@themashup/core';
import { useApp } from '@/state/store';
import { EmptyState, glide, snap } from '@/components/ui/primitives';
import { HeartIcon, LibraryIcon, QueueIcon, TrashIcon } from '@/components/ui/icons';
import { playlistTracks } from '@/lib/playlists';
import { haptic } from '@/lib/haptics';
import { TrackRow } from '@/components/library/TrackRow';

type Tab = 'history' | 'likes' | 'playlists';

export function LibraryScreen({ onPlay }: { onPlay: (t: Track, list: Track[]) => void }) {
  const [tab, setTab] = useState<Tab>('history');
  const history = useApp((s) => s.history);
  const likes = useApp((s) => s.likes);
  const userPlaylists = useApp((s) => s.playlists);

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
            ['playlists', 'Playlists'],
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
        ) : tab === 'playlists' ? (
          userPlaylists.length ? (
            <div className="space-y-1.5">
              {userPlaylists.map((p) => {
                const tracks = playlistTracks(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (!tracks.length) return;
                      haptic('tap');
                      onPlay(tracks[0]!, tracks);
                    }}
                    disabled={!tracks.length}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] px-3 py-2.5 text-left disabled:opacity-55"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
                      <QueueIcon width={17} height={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px]">{p.name}</div>
                      <div className="text-[11px] text-[var(--color-text-3)]">
                        {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
                        {tracks.length ? '' : ' · add songs from any row'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<QueueIcon width={30} height={30} />}
              title="No playlists yet"
              detail="Open the menu on any song and choose a playlist, or make a new one there. Playlists only contain what you put in them."
            />
          )
        ) : history.length ? (
          history.map((t, i) => <TrackRow key={`${t.id}-h${i}`} track={t} index={i} onPlay={() => onPlay(t, history)} />)
        ) : (
          <EmptyState
            icon={<LibraryIcon width={30} height={30} />}
            title="Your history is empty"
            detail="Tracks you play are remembered here (and only here) to power resume, recommendations and lyric search."
          />
        )}
      </motion.div>
    </div>
  );
}
