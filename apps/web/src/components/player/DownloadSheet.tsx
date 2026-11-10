/**
 * Download sheet.
 *
 * Shows the *actual* ladder returned for this track and states plainly what each target does:
 * stream copy / remux / transcode. Premium-locked tiers are visible but locked — hiding them would
 * be less honest, and showing them as available would be a lie.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { AudioFormat, StreamInfo, Track, VideoFormat } from '@themashup/core';
import { service } from '@/lib/service';
import { startDownload, type Target } from '@/lib/downloader';
import { store } from '@/state/store';
import { glide, Skeleton, snap } from '@/components/ui/primitives';
import { CloseIcon, DownloadIcon } from '@/components/ui/icons';
import { pushOverlay } from '@/lib/overlays';

type Row =
  | { kind: 'audio'; label: string; detail: string; format: AudioFormat; usable: boolean }
  | { kind: 'video'; label: string; detail: string; format: VideoFormat; usable: boolean };

export function DownloadSheet({ track, onClose }: { track: Track; onClose: () => void }) {
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void service.resolveStream(track.id).then((res) => {
      if (cancelled) return;
      setBusy(false);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setStream(res.info);
    });
    return () => {
      cancelled = true;
    };
  }, [track.id]);

  /*
   * This sheet opens on top of the full player, which is already full-screen with its own backdrop.
   * Two stacked dim layers made it genuinely unclear which one a tap would dismiss, and hardware
   * back had no idea the sheet existed — it went straight to the page behind. Registering the close
   * here means back takes the topmost thing first, which is the only ordering that makes sense.
   */
  useEffect(() => {
    const off = pushOverlay(onClose);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      off();
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const rows: Row[] = [];
  if (stream) {
    for (const f of stream.audio) {
      const usable = f.deliver === 'url' && !f.premiumOnly;
      rows.push({
        kind: 'audio',
        label: `${f.container.toUpperCase()} · ${f.nominalKbps} kbps`,
        detail: `${f.codec}${f.premiumOnly ? ' · needs Premium' : ''} · ${
          f.deliver === 'url' ? 'direct stream copy' : f.deliver === 'cipher' ? 'signature-locked' : 'unavailable'
        }`,
        format: f,
        usable,
      });
    }
    for (const v of stream.video) {
      const usable = v.deliver === 'url';
      rows.push({
        kind: 'video',
        label: `${v.container.toUpperCase()} · ${v.res}${v.fps > 30 ? ` ${v.fps}fps` : ''}`,
        detail: `${v.codec} · ${v.kbps} kbps · ${service.describeTarget(v)}${v.hasAudio ? ' · includes audio' : ' · video only'}`,
        format: v,
        usable,
      });
    }
  }

  const start = (row: Row) => {
    const url = stream?.urls[row.format.itag];
    if (!url) {
      store.notify('This tier has no direct URL — try another.', 'error');
      return;
    }
    const container = ('container' in row.format ? row.format.container : 'm4a') as Target['container'];
    const target: Target = {
      label: row.label,
      container,
      itag: row.format.itag,
      needsTranscode: false,
      ...(row.kind === 'audio' ? { kbps: row.format.nominalKbps } : {}),
    };
    void startDownload(track, url, target);
    onClose();
  };

  // Portalled: the page container animates `scale`/`y`, and a transformed ancestor makes
  // `position: fixed` resolve against it instead of the viewport. Rendered in place, this sheet sat
  // inside a few hundred pixels of the page and its backdrop was mostly untappable — the same
  // containment bug that trapped the user in the "add to" sheet.
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Download ${track.title}`}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={glide}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-sheet)] border-t border-[var(--hairline)] bg-[var(--color-raised)] pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--color-raised)]/95 px-5 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Download</div>
            <div className="truncate text-[11.5px] text-[var(--color-text-2)]">
              {track.title} · {track.artist}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-[color-mix(in_oklab,var(--wash)_9%,transparent)]"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div className="px-5 pt-3">
          {busy ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-4 text-[13px] text-[var(--color-danger)]">
              {error}
            </div>
          ) : (
            <>
              <div className="mb-3 rounded-2xl bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] p-3 text-[11.5px] leading-relaxed text-[var(--color-text-2)]">
                Resolved via <strong className="text-[var(--color-text)]">{stream?.profile}</strong> · URLs expire in{' '}
                {stream ? Math.round(stream.expiresInSec / 3600) : 0} h, so downloads start immediately. FLAC is a
                lossless <em>container</em> — the source itself is lossy, and the app will never pretend otherwise.
              </div>

              <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
                Audio
              </div>
              <AnimatePresence initial={false}>
                {rows
                  .filter((r) => r.kind === 'audio')
                  .map((r) => (
                    <FormatRow key={`a-${r.format.itag}`} row={r} onPick={() => start(r)} />
                  ))}
              </AnimatePresence>

              <div className="mb-1.5 mt-4 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
                Video
              </div>
              <AnimatePresence initial={false}>
                {rows
                  .filter((r) => r.kind === 'video')
                  .map((r) => (
                    <FormatRow key={`v-${r.format.itag}`} row={r} onPick={() => start(r)} />
                  ))}
              </AnimatePresence>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function FormatRow({ row, onPick }: { row: Row; onPick: () => void }) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={snap}
      disabled={!row.usable}
      onClick={onPick}
      className={`mb-1.5 flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
        row.usable
          ? 'border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] hover:border-[var(--accent)]/50 hover:bg-[color-mix(in_oklab,var(--wash)_9%,transparent)]'
          : 'cursor-not-allowed border-[color-mix(in_oklab,var(--wash)_8%,transparent)] bg-[color-mix(in_oklab,var(--wash)_2%,transparent)] opacity-50'
      }`}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
        <DownloadIcon width={16} height={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{row.label}</div>
        <div className="truncate text-[11px] text-[var(--color-text-3)]">{row.detail}</div>
      </div>
      {row.usable ? (
        <span className="shrink-0 rounded-full bg-[var(--accent)]/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
          Get
        </span>
      ) : (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-text-3)]">Locked</span>
      )}
    </motion.button>
  );
}
