/**
 * Downloads page — live jobs from the SSE-backed downloadsStore.
 *
 * Active rows show server progress (percent/speed/ETA) with cancel;
 * finished rows show size + an Open button hitting the gateway file route
 * (attachment headers decide filename & disposition). Failed rows retry
 * with the same quality.
 */
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CloudDownload,
  Download,
  Loader2,
  Music2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { DownloadJob } from "@themashup/shared";
import { formatBytes, formatSpeed, formatTimeLeft } from "@themashup/shared";
import { api } from "../../lib/api";
import { isDesktop, saveJobFile } from "../../lib/desktop";
import { useUIStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useDownloadsStore, activeJobs, doneJobs } from "../../stores/downloadsStore";

function ProgressRow({ job }: { job: DownloadJob }) {
  const cancel = useDownloadsStore((s) => s.cancel);
  const pct = Math.max(0, Math.min(100, job.progress ?? 0));
  return (
    <div className="flex items-center gap-3 rounded-lg border border-base-3 bg-base-2 p-3">
      <Art job={job} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{job.title ?? job.video_id}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <span className="rounded bg-base-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            {job.container} · {job.quality}
          </span>
          <span className="capitalize">{job.status}</span>
          {job.status === "downloading" && <span>· {formatSpeed(job.speed_bps ?? 0)}</span>}
          {typeof job.eta_s === "number" && job.eta_s > 0 && <span>· {formatTimeLeft(job.eta_s)}</span>}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-base-3">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs font-semibold tabular-nums text-fg-muted">{pct.toFixed(0)}%</span>
        <button
          type="button"
          onClick={() => void cancel(job.id)}
          className="rounded-full p-1.5 text-fg-muted transition hover:bg-danger-soft hover:text-danger"
          aria-label="Cancel download"
          title="Cancel"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function Art({ job }: { job: DownloadJob }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-base-3 text-fg-faint">
      <Music2 size={16} />
    </div>
  );
}

function FinishedRow({ job }: { job: DownloadJob }) {
  const create = useDownloadsStore((s) => s.create);
  const failed = job.status === "failed";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-base-3 bg-base-2 p-3">
      <Art job={job} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{job.title ?? job.video_id}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
          <span className="rounded bg-base-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            {job.container} · {job.quality}
          </span>
          {job.filesize ? <span>{formatBytes(job.filesize)}</span> : null}
          {failed ? (
            <span className="text-danger">{job.error || "failed"}</span>
          ) : (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 size={12} /> ready
            </span>
          )}
        </p>
      </div>
      {failed ? (
        <button
          type="button"
          onClick={() =>
            void create(
              { id: job.video_id, title: job.title } as never,
              job.container,
              job.quality,
            ).catch(() => undefined)
          }
          className="flex items-center gap-1.5 rounded-md border border-base-3 px-3 py-1.5 text-xs font-medium transition hover:border-accent hover:text-accent"
        >
          <RefreshCw size={13} /> Retry
        </button>
      ) : (
        <a
          href={api.fileUrl(job.id)}
          target="_blank"
          rel="noreferrer"
          download
          title={isDesktop() ? "Save to a folder of your choice" : "Open file"}
          onClick={(e) => {
            if (!isDesktop()) return;
            // Desktop: native Save dialog instead of the browser download shelf.
            e.preventDefault();
            void saveJobFile(job).then((outcome) => {
              if (outcome === "unavailable") {
                window.open(api.fileUrl(job.id), "_blank");
              }
            });
          }}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:opacity-90"
        >
          <Download size={13} /> {isDesktop() ? "Save" : "Open"}
        </a>
      )}
    </div>
  );
}

export function DownloadsPage() {
  const jobs = useDownloadsStore((s) => s.jobs);
  const connected = useDownloadsStore((s) => s.connected);
  const ensureStream = useDownloadsStore((s) => s.ensureStream);
  const setPage = useUIStore((s) => s.setPage);
  const mode = useSessionStore((s) => s.mode);
  const [ffmpeg, setFfmpeg] = useState<boolean | null>(null);

  useEffect(() => {
    if (mode !== "none") ensureStream();
  }, [mode, ensureStream]);

  useEffect(() => {
    let stale = false;
    api
      .health()
      .then((h) => !stale && setFfmpeg(h.resolver?.ffmpeg ?? null))
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, []);

  const active = activeJobs(jobs);
  const finished = doneJobs(jobs);

  if (mode === "none") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <CloudDownload size={44} className="text-fg-faint" strokeWidth={1.4} />
        <div>
          <h2 className="text-lg font-semibold">Downloads live in your account</h2>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Sign in so jobs can track your progress across refreshes — then pick a
            quality and watch it here live.
          </p>
        </div>
        <button
          type="button"
          onClick={() => useUIStore.getState().setAuthModalOpen(true)}
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition hover:opacity-90"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Downloads</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {active.length > 0
                ? `${active.length} in progress`
                : "Everything you grab, in one place"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-fg-muted">
            {ffmpeg !== null && (
              <span
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                  ffmpeg ? "border-success/40 text-success" : "border-base-3"
                }`}
              >
                {ffmpeg ? <CheckCircle2 size={12} /> : <Loader2 size={12} />}
                {ffmpeg ? "ffmpeg ready" : "transcoding limited"}
              </span>
            )}
            <span
              className={`flex items-center gap-1.5 rounded-full border border-base-3 px-2.5 py-1 ${
                connected ? "text-success" : "text-fg-muted"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-success" : "bg-fg-faint"}`}
              />
              {connected ? "live" : "reconnecting…"}
            </span>
          </div>
        </header>

        {active.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              In progress
            </h2>
            <div className="space-y-2">
              {active.map((job) => (
                <ProgressRow key={job.id} job={job} />
              ))}
            </div>
          </section>
        )}

        {finished.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Finished
            </h2>
            <div className="space-y-2">
              {finished.map((job) => (
                <FinishedRow key={job.id} job={job} />
              ))}
            </div>
          </section>
        )}

        {active.length === 0 && finished.length === 0 && (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-base-3 px-6 py-14 text-center">
            <CloudDownload size={40} className="text-fg-faint" strokeWidth={1.4} />
            <div>
              <p className="font-medium">No downloads yet</p>
              <p className="mt-1 text-sm text-fg-muted">
                Hit the download icon on any track and pick a quality —
                MP3, FLAC, Opus or MP4 video.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPage("search")}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90"
            >
              <Search size={15} /> Find something
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
