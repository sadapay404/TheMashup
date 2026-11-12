/**
 * "Add to" — one popup, two destinations: the queue, or a playlist.
 *
 * The row used to have a queue button only, and adding to a playlist meant there was no way at all.
 * Offering both here means the user answers one question ("where does this go?") instead of
 * hunting for two different controls.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import type { Track } from '@themashup/core';
import { store } from '@/state/store';
import { glide, snap } from '@/components/ui/primitives';
import { pushOverlay } from '@/lib/overlays';
import { CheckIcon, CloseIcon, PlusIcon, QueueIcon } from '@/components/ui/icons';
import {
  addToPlaylist,
  createPlaylist,
  playlists,
  playlistsContaining,
} from '@/lib/playlists';
import { haptic } from '@/lib/haptics';

export function AddToSheet({
  track,
  onQueue,
  onClose,
}: {
  track: Track;
  onQueue?: (t: Track) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(playlists);
  const [containing, setContaining] = useState(() => playlistsContaining(track.id));
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  // Re-read after every change so a newly made playlist appears without remounting the sheet.
  useEffect(() => {
    setAll(playlists());
    setContaining(playlistsContaining(track.id));
  }, [track.id]);

  const refresh = () => {
    setAll(playlists());
    setContaining(playlistsContaining(track.id));
  };

  const add = (playlistId: string) => {
    const result = addToPlaylist(playlistId, track);
    if (result === 'added') {
      haptic('success');
      store.notify(`Added to ${all.find((p) => p.id === playlistId)?.name ?? 'playlist'}`, 'success');
    } else if (result === 'duplicate') {
      haptic('tap');
      store.notify('Already in that playlist', 'info');
    }
    refresh();
  };

  // Hardware back must close this sheet. Registering here keeps the knowledge next to the component
  // that owns it; the app-level handler just asks the stack.
  useEffect(() => pushOverlay(onClose), [onClose]);

  // Escape is the reflex for "get me out of this" on a keyboard, and Android's back button maps to
  // the same intent. Neither worked: the sheet had no key handler, and the app-level back handler
  // does not know a sheet is open. Registering here keeps the knowledge next to the component that
  // owns it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  /*
   * Rendered into `document.body`, not in place.
   *
   * The sheet is opened from inside `TrackRow`, whose wrapper is a `motion.div` with a
   * `whileTap={{ scale }}`. A transform on an ancestor makes it the containing block for
   * `position: fixed`, so the backdrop and panel were being positioned against a 72-pixel-tall row
   * instead of the viewport — the panel appeared misplaced, and the full-screen tap-to-dismiss
   * backdrop had no area outside the sheet to occupy. That is why it felt impossible to get out of.
   */
  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 32, opacity: 0 }}
        transition={glide}
        role="dialog"
        aria-label={`Add ${track.title}`}
        className="fixed inset-x-0 bottom-0 z-[71] mx-auto max-h-[72dvh] max-w-2xl overflow-y-auto rounded-t-[26px] border-t border-[var(--hairline)] bg-[var(--color-void)] px-4 pb-[calc(var(--safe-b)+16px)] pt-4"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-3)]">
              Add to
            </div>
            <h2 className="truncate text-[14px] font-semibold">{track.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 text-[var(--color-text-3)]">
            <CloseIcon width={17} height={17} />
          </button>
        </div>

        {onQueue ? (
          <button
            type="button"
            onClick={() => {
              haptic('tap');
              onQueue(track);
              store.notify('Added to the queue', 'success');
              onClose();
            }}
            className="mb-3 flex w-full items-center gap-3 rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_6%,transparent)] px-3 py-3 text-left"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--wash)_8%,transparent)]">
              <QueueIcon width={17} height={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px]">Queue</div>
              <div className="text-[11px] text-[var(--color-text-3)]">Play after what is playing now</div>
            </div>
          </button>
        ) : null}

        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-3)]">
            Playlists
          </span>
          <button
            type="button"
            onClick={() => {
              haptic('tap');
              setCreating((v) => !v);
            }}
            className="flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)]"
          >
            <PlusIcon width={13} height={13} />
            New
          </button>
        </div>

        <AnimatePresence initial={false}>
          {creating ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={snap}
              className="overflow-hidden"
            >
              <div className="mb-2 flex gap-1.5">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Playlist name"
                  aria-label="New playlist name"
                  className="min-w-0 flex-1 rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_7%,transparent)] px-3 py-2.5 text-[13px] outline-none placeholder:text-[var(--color-text-3)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const p = createPlaylist(draft);
                    if (!p) {
                      haptic('error');
                      store.notify('Give the playlist a name', 'error');
                      return;
                    }
                    add(p.id);
                    setDraft('');
                    setCreating(false);
                  }}
                  className="shrink-0 rounded-[var(--radius-row)] bg-[var(--color-accent)] px-4 text-[13px] font-semibold text-[var(--color-void)]"
                >
                  Create
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {all.length ? (
          <div className="space-y-1">
            {all.map((p) => {
              const inside = containing.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => add(p.id)}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-row)] px-2 py-2.5 text-left"
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
                    <QueueIcon width={15} height={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{p.name}</div>
                    <div className="text-[10.5px] text-[var(--color-text-3)]">
                      {p.trackIds.length} {p.trackIds.length === 1 ? 'track' : 'tracks'}
                    </div>
                  </div>
                  {inside ? <CheckIcon width={15} height={15} className="shrink-0 text-[var(--accent)]" /> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-3 text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
            No playlists yet. Make one here and the song goes straight into it.
          </p>
        )}
      </motion.div>
    </>,
    document.body,
  );
}
