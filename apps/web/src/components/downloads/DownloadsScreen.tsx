/**
 * Downloads: folders on top, files below.
 *
 * The organising idea is a file manager, because that is what the user asked for and what the
 * underlying storage actually is. Two fixed buckets (songs, videos) always exist; a playlist
 * download creates its own folder inside whichever section it belongs to.
 *
 * Honest states: a failed download stays visible with its reason instead of being quietly dropped,
 * and a file only counts as stored once the pipeline says `done`.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { Track } from '@themashup/core';
import { store, useApp, type DownloadFolder, type DownloadJob, type MediaKind } from '@/state/store';
import { Chip, EmptyState, glide, snap } from '@/components/ui/primitives';
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  FolderIcon,
  FolderOpenIcon,
  MoveIcon,
  TrashIcon,
  VideoIcon,
} from '@/components/ui/icons';
import {
  deleteFolder,
  fileCount,
  filesIn,
  foldersOf,
  moveToFolder,
  renameFolder,
  syncFolderToDisk,
  SYSTEM_FOLDER,
} from '@/lib/folders';
import { haptic } from '@/lib/haptics';
import { batchProgress, cancelPlaylist } from '@/lib/playlist';

const SECTIONS: { id: MediaKind; label: string }[] = [
  { id: 'music', label: 'Songs' },
  { id: 'video', label: 'Videos' },
];

function formatBytes(n: number | undefined): string {
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const STATE_LABEL: Record<DownloadJob['state'], string> = {
  queued: 'Queued',
  resolving: 'Finding a source',
  downloading: 'Downloading',
  muxing: 'Finishing',
  done: 'Stored',
  failed: 'Failed',
  partial: 'Incomplete',
};

export function DownloadsScreen({ onPlay }: { onPlay: (t: Track, list: Track[]) => void }) {
  const folders = useApp((s) => s.folders);
  const downloads = useApp((s) => s.downloads);
  const batches = useApp((s) => s.playlistBatches);
  const [kind, setKind] = useState<MediaKind>('music');
  const [openFolder, setOpenFolder] = useState<string | null>(SYSTEM_FOLDER.music);
  const [moving, setMoving] = useState<DownloadJob | null>(null);
  const [renaming, setRenaming] = useState<DownloadFolder | null>(null);
  const [draft, setDraft] = useState('');

  // Recomputed from the live slices so a move or a delete is visible immediately.
  const sectionFolders = useMemo(() => folders.filter((f) => f.kind === kind), [folders, kind]);
  const active = openFolder && sectionFolders.some((f) => f.id === openFolder) ? openFolder : SYSTEM_FOLDER[kind];
  const files = useMemo(() => filesIn(active), [downloads, active]);
  const activeFolder = sectionFolders.find((f) => f.id === active) ?? null;
  const playable = files.filter((f) => f.state === 'done').map((f) => f.track);

  const switchSection = (next: MediaKind) => {
    haptic('tap');
    setKind(next);
    setOpenFolder(SYSTEM_FOLDER[next]);
  };

  return (
    <div className="px-4 pb-[var(--content-bottom)] pt-3">
      <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-none">Downloads</h1>
      <p className="mt-1 text-[12px] text-[var(--color-text-3)]">
        {downloads.filter((d) => d.state === 'done').length} stored ·{' '}
        {formatBytes(downloads.reduce((n, d) => n + (d.totalBytes ?? 0), 0)) || '0 B'} on this device
      </p>

      {/* Section switch. Songs and videos are separate lists, not a filter over one list. */}
      <div className="mt-4 flex gap-1 rounded-full bg-[color-mix(in_oklab,var(--wash)_6%,transparent)] p-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => switchSection(s.id)}
            className="relative flex-1 rounded-full px-3 py-2 text-[12.5px] font-semibold"
          >
            {kind === s.id ? (
              <motion.span
                layoutId="dl-section"
                className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--wash)_11%,transparent)]"
                transition={snap}
              />
            ) : null}
            <span className={kind === s.id ? 'relative z-10' : 'relative z-10 text-[var(--color-text-3)]'}>
              {s.label}
            </span>
          </button>
        ))}
      </div>

      {/* Folders first, as asked: they are the top level of the list, above the files. */}
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-3)]">
            Folders
          </span>
          <span className="text-[10.5px] text-[var(--color-text-3)]">{sectionFolders.length}</span>
        </div>
        {sectionFolders.map((f) => {
          const isOpen = f.id === active;
          return (
            <motion.div
              key={f.id}
              layout="position"
              transition={glide}
              className="overflow-hidden rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_5%,transparent)]"
            >
              <button
                type="button"
                onClick={() => {
                  haptic('tap');
                  setOpenFolder(isOpen ? null : f.id);
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                aria-expanded={isOpen}
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
                  {isOpen ? <FolderOpenIcon width={17} height={17} /> : <FolderIcon width={17} height={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{f.name}</div>
                  <div className="text-[11px] text-[var(--color-text-3)]">
                    {(() => {
                      const batch = batches.find((b) => b.folderId === f.id);
                      if (batch && batch.state === 'running') {
                        return `Downloading ${Math.min(batch.cursor + 1, batch.trackIds.length)} of ${batch.trackIds.length}`;
                      }
                      if (batch && batch.state === 'cancelled') {
                        return `Stopped at ${batch.cursor} of ${batch.trackIds.length}`;
                      }
                      const n = fileCount(f.id);
                      return `${n} ${n === 1 ? 'file' : 'files'}${f.system ? ' · always shown' : ''}`;
                    })()}
                  </div>
                </div>
                <ChevronDownIcon
                  width={16}
                  height={16}
                  className="shrink-0 text-[var(--color-text-3)] transition-transform"
                  style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
                />
              </button>

              <AnimatePresence initial={false}>
                {isOpen ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={settleHeight}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1 px-2 pb-2">
                      {files.length ? (
                        files.map((j) => (
                          <FileRow
                            key={j.id}
                            job={j}
                            onPlay={() => onPlay(j.track, playable)}
                            onMove={() => {
                              haptic('tap');
                              setMoving(j);
                            }}
                          />
                        ))
                      ) : (
                        <p className="px-2 py-3 text-[11.5px] leading-relaxed text-[var(--color-text-3)]">
                          {f.system
                            ? 'Nothing here yet. Downloads that are not filed into a folder land here.'
                            : 'Empty. Move a file in from another folder, or download this playlist again.'}
                        </p>
                      )}
                    </div>

                    {(() => {
                      const batch = batches.find((b) => b.folderId === f.id && b.state === 'running');
                      if (!batch) return null;
                      return (
                        <div className="flex items-center gap-2 px-3 pb-1">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--wash)_8%,transparent)]">
                            <motion.div
                              className="h-full rounded-full bg-[var(--color-accent)]"
                              animate={{ width: `${Math.round(batchProgress(batch) * 100)}%` }}
                              transition={glide}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              haptic('tap');
                              cancelPlaylist(batch.id);
                            }}
                            className="shrink-0 text-[10.5px] text-[var(--color-text-3)]"
                          >
                            Stop
                          </button>
                        </div>
                      );
                    })()}

                    {!f.system ? (
                      <div className="flex items-center gap-1.5 border-t border-[var(--hairline)] px-3 py-2">
                        <Chip
                          onClick={() => {
                            haptic('tap');
                            setRenaming(f);
                            setDraft(f.name);
                          }}
                        >
                          Rename
                        </Chip>
                        <Chip
                          onClick={() => {
                            const res = deleteFolder(f.id);
                            if (res) {
                              haptic('tap');
                              store.notify(
                                res.folded
                                  ? `Folder removed — ${res.folded} ${res.folded === 1 ? 'file' : 'files'} moved to ${f.kind === 'video' ? 'Videos' : 'All songs'}`
                                  : 'Folder removed',
                                'info',
                              );
                              setOpenFolder(SYSTEM_FOLDER[f.kind]);
                            }
                          }}
                        >
                          Delete
                        </Chip>
                      </div>
                    ) : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Files that are not stored yet, so an in-flight or failed download is never invisible. */}
      <PendingList kind={kind} />

      <AnimatePresence>
        {moving ? (
          <MoveSheet
            job={moving}
            folders={folders.filter((f) => f.kind === (moving.kind ?? 'music'))}
            onClose={() => setMoving(null)}
            onMove={(folderId) => {
              const jobId = moving.id;
              const res = moveToFolder([jobId], folderId);
              if (!res.folder || !res.moved) {
                setMoving(null);
                return;
              }
              const target = res.folder;
              haptic('success');
              store.notify(`Moved to ${target.name}`, 'success');
              setOpenFolder(folderId);
              setMoving(null);
              // The list moved immediately; the file follows. If the disk refuses, the earlier
              // message would be a lie, so it is corrected rather than left standing.
              void syncFolderToDisk([jobId], folderId).then((failed) => {
                if (!failed) return;
                haptic('error');
                store.notify('Filed in the app, but the file could not be moved on disk', 'error');
              });
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {renaming ? (
          <Sheet onClose={() => setRenaming(null)} title="Rename folder">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_7%,transparent)] px-3 py-3 text-[14px] outline-none"
              aria-label="Folder name"
            />
            <button
              type="button"
              onClick={() => {
                if (renameFolder(renaming.id, draft)) {
                  haptic('success');
                  store.notify('Folder renamed', 'success');
                  setRenaming(null);
                } else {
                  haptic('error');
                  store.notify('That name is empty or already used here', 'error');
                }
              }}
              className="mt-2 w-full rounded-[var(--radius-row)] bg-[var(--color-accent)] px-3 py-3 text-[14px] font-semibold text-[var(--color-void)]"
            >
              Save
            </button>
          </Sheet>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const settleHeight = { type: 'spring', stiffness: 340, damping: 34, mass: 0.9 } as const;

function FileRow({ job, onPlay, onMove }: { job: DownloadJob; onPlay: () => void; onMove: () => void }) {
  const stored = job.state === 'done';
  return (
    <div className="flex items-center gap-2 rounded-xl px-1.5 py-1.5">
      <button
        type="button"
        onClick={stored ? onPlay : undefined}
        disabled={!stored}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:opacity-60"
      >
        {job.track.thumbs[0]?.url ? (
          <img
            src={job.track.thumbs[0]?.url}
            alt=""
            className="h-8 w-8 shrink-0 rounded-lg object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
            <DownloadIcon width={14} height={14} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px]">{job.track.title}</div>
          <div className="truncate text-[10.5px] text-[var(--color-text-3)]">
            {job.track.artist}
            {stored ? ` · ${job.target}` : ` · ${STATE_LABEL[job.state]}`}
            {job.state === 'downloading' ? ` ${Math.round(job.progress * 100)}%` : ''}
            {job.error && !stored ? ` · ${job.error}` : ''}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onMove}
        aria-label={`Move ${job.track.title} to another folder`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-text-3)]"
      >
        <MoveIcon width={15} height={15} />
      </button>
    </div>
  );
}

function PendingList({ kind }: { kind: MediaKind }) {
  const downloads = useApp((s) => s.downloads);
  const pending = downloads.filter((d) => (d.kind ?? 'music') === kind && d.state !== 'done');
  if (!pending.length) return null;
  return (
    <div className="mt-5 space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-3)]">
          In progress
        </span>
        <span className="text-[10.5px] text-[var(--color-text-3)]">{pending.length}</span>
      </div>
      {pending.map((j) => (
        <div
          key={j.id}
          className="flex items-center gap-3 rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_4%,transparent)] px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px]">{j.track.title}</div>
            <div className="truncate text-[10.5px] text-[var(--color-text-3)]">
              {STATE_LABEL[j.state]}
              {j.state === 'downloading' ? ` · ${Math.round(j.progress * 100)}%` : ''}
              {j.error ? ` · ${j.error}` : ''}
            </div>
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-3)]">
            {formatBytes(j.bytes)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MoveSheet({
  job,
  folders,
  onClose,
  onMove,
}: {
  job: DownloadJob;
  folders: DownloadFolder[];
  onClose: () => void;
  onMove: (folderId: string) => void;
  onDiskFailure?: () => void;
}) {
  const current = job.folderId ?? SYSTEM_FOLDER[job.kind ?? 'music'];
  return (
    <Sheet onClose={onClose} title={`Move “${job.track.title}”`}>
      <div className="space-y-1">
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onMove(f.id)}
            disabled={f.id === current}
            className="flex w-full items-center gap-3 rounded-[var(--radius-row)] px-2 py-2.5 text-left disabled:opacity-45"
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
              {f.kind === 'video' ? <VideoIcon width={15} height={15} /> : <FolderIcon width={15} height={15} />}
            </div>
            <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
            {f.id === current ? <CheckIcon width={15} height={15} className="shrink-0" /> : null}
          </button>
        ))}
      </div>
      <p className="mt-2 px-2 text-[11px] leading-relaxed text-[var(--color-text-3)]">
        Folders appear here as they are created. A playlist download makes its own folder automatically.
      </p>
    </Sheet>
  );
}

function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 28, opacity: 0 }}
        transition={glide}
        role="dialog"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-[61] mx-auto max-w-2xl rounded-t-[26px] border-t border-[var(--hairline)] bg-[var(--color-void)] px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="truncate pr-3 text-[14px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-[12px] text-[var(--color-text-3)]"
          >
            Cancel
          </button>
        </div>
        {children}
      </motion.div>
    </>
  );
}
