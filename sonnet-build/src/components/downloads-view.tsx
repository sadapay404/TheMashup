"use client";
import { fmtBytes } from "@/lib/format";
import { Artwork, Empty, Icon, IconButton, SectionTitle } from "./ui";
import { QUALITIES, useDownloads } from "./downloads-context";
import { usePlayer } from "./player-context";

export function DownloadsView() {
  const { jobs, offline, pause, resume, cancel, clearFinished, removeOffline, saveFile } = useDownloads();
  const { playQueue } = usePlayer();
  const label = (q: string) => QUALITIES.find((x) => x.id === q)?.label ?? q;
  const active = jobs.filter((j) => j.status !== "done");
  const offlineTracks = offline.map((o) => o.track);

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">Downloads</h1>
      <p className="mt-1 text-sm text-muted">Tracks saved here play without a connection. Audio conversion (MP3 via ffmpeg) is available in the Android and Windows apps; the web edition saves the source stream at the nearest bitrate.</p>

      <SectionTitle action={jobs.some((j) => ["done", "error", "cancelled"].includes(j.status)) ? <button onClick={clearFinished} className="text-sm font-semibold text-accent">Clear finished</button> : undefined}>Queue</SectionTitle>
      {active.length ? (
        <div className="space-y-2">
          {active.map((j) => {
            const pct = j.total ? Math.min(100, (j.received / j.total) * 100) : 0;
            return (
              <div key={j.id} className="rounded-2xl border border-outline bg-surface p-3">
                <div className="flex items-center gap-3">
                  <Artwork src={j.track.artwork} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{j.track.title}</p>
                    <p className="truncate text-xs text-muted">
                      {j.track.artist} · {label(j.quality)} ·{" "}
                      <span className={j.status === "error" ? "text-red-400" : "text-accent"}>
                        {j.status === "error" ? j.error : j.status}
                      </span>
                    </p>
                  </div>
                  {j.status === "downloading" && (
                    <button onClick={() => pause(j.id)} className="rounded-full border border-outline px-3 py-1 text-xs font-semibold hover:border-accent">Pause</button>
                  )}
                  {(j.status === "paused" || j.status === "error") && (
                    <button onClick={() => resume(j.id)} className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">{j.status === "error" ? "Retry" : "Resume"}</button>
                  )}
                  {j.status !== "cancelled" && <IconButton icon="close" label="Cancel" size={18} onClick={() => cancel(j.id)} />}
                </div>
                {(j.status === "downloading" || j.status === "paused") && (
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                      <div className={`h-full rounded-full bg-accent transition-all ${j.total ? "" : "animate-pulse"}`} style={{ width: j.total ? `${pct}%` : "30%" }} />
                    </div>
                    <p className="mt-1 text-right text-[11px] tabular-nums text-subtle">
                      {fmtBytes(j.received)}
                      {j.total ? ` / ${fmtBytes(j.total)} · ${pct.toFixed(0)}%` : ""}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="download" title="No active downloads" hint="Use ⋯ → Download… on any track and pick a quality." />
      )}

      <SectionTitle action={offline.length ? <button onClick={() => playQueue(offlineTracks, 0)} className="flex items-center gap-1 text-sm font-semibold text-accent"><Icon name="play" size={16} /> Play all</button> : undefined}>On this device</SectionTitle>
      {offline.length ? (
        <div className="space-y-0.5">
          {offline.map((o, i) => (
            <div key={o.key} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-raised/70">
              <button onClick={() => playQueue(offlineTracks, i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Artwork src={o.track.artwork} size={48} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{o.track.title}</p>
                  <p className="truncate text-xs text-muted">{o.track.artist} · {label(o.quality)} · {fmtBytes(o.size)}</p>
                </div>
              </button>
              <button onClick={() => saveFile(o)} className="rounded-full border border-outline px-3 py-1 text-xs font-semibold hover:border-accent">Save file</button>
              <IconButton icon="trash" label="Delete" size={18} onClick={() => void removeOffline(o.key)} />
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="note" title="No offline tracks yet" />
      )}
    </div>
  );
}
