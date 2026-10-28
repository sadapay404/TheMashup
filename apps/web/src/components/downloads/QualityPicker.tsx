/**
 * Quality picker — choose container/quality before a download job starts.
 *
 * Opens over the app (uiStore.downloadTrack), pre-fills from the resolver's
 * /formats manifest (video heights actually available for the track), falls
 * back to the full target list when the manifest can't be fetched, then POSTs
 * /api/downloads and closes (progress lives on the Downloads page + sidebar).
 */
import { useEffect, useState } from "react";
import { Loader2, Music2, Video, X } from "lucide-react";
import type { FormatManifest, Track } from "@themashup/shared";
import { api } from "../../lib/api";
import { useUIStore } from "../../stores/uiStore";
import { useDownloadsStore } from "../../stores/downloadsStore";
import { useSessionStore } from "../../stores/sessionStore";
import { formatBytes } from "@themashup/shared";

interface Chip {
  container: string;
  quality: string;
  label: string;
  sub: string;
}

const AUDIO_CHIPS: Chip[] = [
  { container: "mp3", quality: "128k", label: "MP3 128k", sub: "small, plays everywhere" },
  { container: "mp3", quality: "320k", label: "MP3 320k", sub: "best MP3 quality" },
  { container: "flac", quality: "best", label: "FLAC", sub: "lossless archive" },
  { container: "opus", quality: "best", label: "Opus", sub: "source quality, tiny" },
];

const VIDEO_CHIPS: Chip[] = [
  { container: "mp4", quality: "360p", label: "360p", sub: "smallest video" },
  { container: "mp4", quality: "720p", label: "720p", sub: "HD" },
  { container: "mp4", quality: "1080p", label: "1080p", sub: "Full HD" },
  { container: "mp4", quality: "4k", label: "4K", sub: "Ultra HD" },
];

const heightOf = (quality: string): number => parseInt(quality, 10) || 0;

export function QualityPicker() {
  const track = useUIStore((s) => s.downloadTrack);
  const setTrack = useUIStore((s) => s.setDownloadTrack);
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);
  const mode = useSessionStore((s) => s.mode);
  const create = useDownloadsStore((s) => s.create);

  const [manifest, setManifest] = useState<FormatManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!track) return;
    let stale = false;
    setLoading(true);
    setError(null);
    setManifest(null);
    api
      .formats(track.id)
      .then((m) => {
        if (!stale) setManifest(m);
      })
      .catch(() => {
        if (!stale) setError("Could not load format list — showing all targets");
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [track]);

  if (!track) return null;

  const videoHeights = (manifest?.video ?? [])
    .map((f) => f.height)
    .filter((h): h is number => typeof h === "number" && h > 0);
  const maxHeight = videoHeights.length > 0 ? Math.max(...videoHeights) : null;
  const maxFileSize = (height: number) => {
    const f = (manifest?.video ?? []).filter((v) => v.height === height).map((v) => v.filesize_bytes).find((n) => n && n > 0);
    return f ? formatBytes(f) : null;
  };

  const start = async (chip: Chip) => {
    if (mode === "none") {
      setTrack(null);
      setAuthModalOpen(true);
      return;
    }
    const key = `${chip.container}:${chip.quality}`;
    setBusy(key);
    setError(null);
    try {
      await create(track, chip.container, chip.quality);
      setTrack(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        setTrack(null);
        setAuthModalOpen(true);
      } else {
        setError((e as Error).message || "Could not start download");
      }
    } finally {
      setBusy(null);
    }
  };

  const chipDisabled = (chip: Chip): boolean => {
    if (chip.container === "mp4" && maxHeight !== null) {
      return heightOf(chip.quality) > maxHeight;
    }
    if (chip.container === "mp4" && manifest && manifest.video.length === 0) {
      return true;
    }
    return false;
  };

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose download quality"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={() => setTrack(null)}
      />
      <div className="relative w-[min(460px,94vw)] rounded-lg border border-base-3 bg-base-1 p-6 shadow-large">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-base-2 text-fg-muted">
            {track.artwork_best ?? track.artwork ? (
              <img src={track.artwork_best ?? track.artwork} alt="" className="h-full w-full object-cover" />
            ) : (
              <Music2 size={18} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{track.title}</p>
            <p className="truncate text-xs text-fg-muted">
              {track.artist_names}
              {track.duration_sec ? ` · ${Math.floor(track.duration_sec / 60)}:${String(track.duration_sec % 60).padStart(2, "0")}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTrack(null)}
            className="rounded-full p-1 text-fg-muted transition hover:bg-base-3 hover:text-fg"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="mt-6 flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 size={14} className="animate-spin" /> Loading available formats…
          </div>
        )}

        {!loading && (
          <div className="mt-5 space-y-5">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                <Music2 size={13} /> Audio
              </div>
              <div className="grid grid-cols-2 gap-2">
                {AUDIO_CHIPS.map((chip) => {
                  const key = `${chip.container}:${chip.quality}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void start(chip)}
                      className="group rounded-md border border-base-3 bg-base-2 px-3 py-2.5 text-left transition hover:border-accent hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    >
                      <span className="flex items-center justify-between text-sm font-semibold">
                        {chip.label}
                        {busy === key && <Loader2 size={13} className="animate-spin" />}
                      </span>
                      <span className="block text-[11px] text-fg-muted">{chip.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                <Video size={13} /> Video (MP4)
                {maxHeight !== null && (
                  <span className="font-normal normal-case tracking-normal text-fg-faint">
                    · up to {maxHeight}p for this track
                  </span>
                )}
                {manifest && maxHeight === null && (
                  <span className="font-normal normal-case tracking-normal text-fg-faint">
                    · no video formats
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {VIDEO_CHIPS.map((chip) => {
                  const key = `${chip.container}:${chip.quality}`;
                  const disabled = chipDisabled(chip);
                  const size = chip.container === "mp4" ? maxFileSize(heightOf(chip.quality)) : null;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={disabled || busy !== null}
                      onClick={() => void start(chip)}
                      className="rounded-md border border-base-3 bg-base-2 px-3 py-2.5 text-left transition hover:border-accent hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="flex items-center justify-between text-sm font-semibold">
                        {chip.label}
                        {size && <span className="text-[10px] font-normal text-fg-muted">≈{size}</span>}
                        {busy === key && <Loader2 size={13} className="animate-spin" />}
                      </span>
                      <span className="block text-[11px] text-fg-muted">
                        {disabled ? "not available" : chip.sub}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}
            <p className="text-[11px] leading-relaxed text-fg-faint">
              Files are prepared by the local resolver and show up under Downloads
              the moment they're ready.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
