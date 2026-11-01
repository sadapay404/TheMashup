"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Track } from "@/lib/types";
import { deleteOffline, listOffline, putOffline, type OfflineRecord } from "@/lib/offline";
import { useApp } from "./app-context";

export const QUALITIES = [
  { id: "128", label: "MP3 128k (compact)" },
  { id: "192", label: "MP3 192k" },
  { id: "320", label: "MP3 320k (best)" },
  { id: "mp4", label: "MP4 video" },
] as const;

export type JobStatus = "queued" | "downloading" | "paused" | "done" | "error" | "cancelled";
export type Job = { id: string; track: Track; quality: string; status: JobStatus; received: number; total: number; error?: string };

type Ctx = {
  jobs: Job[];
  offline: OfflineRecord[];
  start: (t: Track, quality: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
  removeOffline: (key: string) => Promise<void>;
  saveFile: (rec: OfflineRecord) => void;
  isOffline: (trackId: string) => boolean;
};

const C = createContext<Ctx | null>(null);
export const useDownloads = () => {
  const c = useContext(C);
  if (!c) throw new Error("DownloadsProvider missing");
  return c;
};

type Runtime = { ctl?: AbortController; chunks: Uint8Array[]; received: number };
const MAX_PARALLEL = 2;

const extFor = (mime: string) =>
  mime.includes("mp4") && mime.startsWith("video") ? "mp4" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("webm") ? "webm" : mime.includes("mpeg") ? "mp3" : "audio";

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const { toast } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [offline, setOffline] = useState<OfflineRecord[]>([]);
  const rts = useRef(new Map<string, Runtime>());
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;

  const refreshOffline = useCallback(async () => setOffline(await listOffline()), []);
  useEffect(() => {
    void refreshOffline();
  }, [refreshOffline]);

  const patch = useCallback((id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j))), []);

  const run = useCallback(
    async (id: string) => {
      const job = jobsRef.current.find((j) => j.id === id);
      const rt = rts.current.get(id);
      if (!job || !rt) return;
      const ctl = new AbortController();
      rt.ctl = ctl;
      patch(id, { status: "downloading", error: undefined });
      try {
        const qs = new URLSearchParams({ id: job.track.id, title: job.track.title, artist: job.track.artist, quality: job.quality });
        if (job.track.previewUrl) qs.set("preview", job.track.previewUrl);
        const headers: Record<string, string> = {};
        if (rt.received > 0) headers.range = `bytes=${rt.received}-`;
        const res = await fetch(`/api/download?${qs}`, { signal: ctl.signal, headers });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            msg = (await res.json()).error ?? msg;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        if (rt.received > 0 && res.status !== 206) {
          rt.chunks = [];
          rt.received = 0;
        }
        const cr = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
        const cl = Number(res.headers.get("content-length") ?? 0);
        const total = cr ? Number(cr[1]) : cl ? cl + rt.received : 0;
        patch(id, { total });
        const reader = res.body!.getReader();
        let last = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          rt.chunks.push(value);
          rt.received += value.length;
          const now = performance.now();
          if (now - last > 150) {
            last = now;
            patch(id, { received: rt.received });
          }
        }
        const mime = res.headers.get("content-type") ?? "audio/mp4";
        const blob = new Blob(rt.chunks as BlobPart[], { type: mime });
        await putOffline({
          key: `${job.track.id}|${job.quality}`,
          trackId: job.track.id,
          track: job.track,
          quality: job.quality,
          blob,
          size: blob.size,
          savedAt: Date.now(),
          mime,
        });
        rts.current.delete(id);
        patch(id, { status: "done", received: blob.size, total: blob.size });
        await refreshOffline();
        toast(`Downloaded “${job.track.title}”`);
      } catch (e) {
        if (ctl.signal.aborted) return; // pause/cancel already updated status
        patch(id, { status: "error", error: e instanceof Error ? e.message : "Download failed" });
      }
    },
    [patch, refreshOffline, toast],
  );

  // scheduler: keep up to MAX_PARALLEL running
  useEffect(() => {
    const running = jobs.filter((j) => j.status === "downloading").length;
    if (running >= MAX_PARALLEL) return;
    const queued = jobs.filter((j) => j.status === "queued").slice(0, MAX_PARALLEL - running);
    queued.forEach((j) => {
      patch(j.id, { status: "downloading" });
      void run(j.id);
    });
  }, [jobs, patch, run]);

  const start = useCallback(
    (t: Track, quality: string) => {
      const id = `${t.id}|${quality}`;
      if (jobsRef.current.some((j) => j.id === id && (j.status === "queued" || j.status === "downloading" || j.status === "paused"))) {
        toast("Already in download queue");
        return;
      }
      rts.current.set(id, { chunks: [], received: 0 });
      setJobs((js) => [{ id, track: t, quality, status: "queued", received: 0, total: 0 }, ...js.filter((j) => j.id !== id)]);
      toast("Download queued");
    },
    [toast],
  );

  const pause = useCallback(
    (id: string) => {
      patch(id, { status: "paused" });
      rts.current.get(id)?.ctl?.abort();
    },
    [patch],
  );
  const resume = useCallback((id: string) => patch(id, { status: "queued" }), [patch]);
  const cancel = useCallback(
    (id: string) => {
      rts.current.get(id)?.ctl?.abort();
      rts.current.delete(id);
      patch(id, { status: "cancelled" });
    },
    [patch],
  );
  const clearFinished = useCallback(
    () => setJobs((js) => js.filter((j) => !["done", "cancelled", "error"].includes(j.status))),
    [],
  );
  const removeOffline = useCallback(
    async (key: string) => {
      await deleteOffline(key);
      await refreshOffline();
    },
    [refreshOffline],
  );
  const saveFile = useCallback((rec: OfflineRecord) => {
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rec.track.artist} - ${rec.track.title}.${extFor(rec.mime)}`.replace(/[\\/:*?"<>|]/g, "_");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, []);

  const offlineIds = useMemo(() => new Set(offline.map((o) => o.trackId)), [offline]);
  const value: Ctx = {
    jobs, offline, start, pause, resume, cancel, clearFinished, removeOffline, saveFile,
    isOffline: (id) => offlineIds.has(id),
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
