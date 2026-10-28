/**
 * Live download jobs (Phase 5).
 *
 * Jobs stream in over SSE (see lib/api.ts downloads.stream); we mirror the
 * server's owner-filtered list into a map, render progress straight off job
 * fields, and keep the stream alive across navigation. Signed-out → no stream.
 */
import { create } from "zustand";
import type { DownloadJob } from "@themashup/shared";
import { api } from "../lib/api";

interface DownloadsState {
  jobs: Record<string, DownloadJob>;
  connected: boolean;
  /** transient toast-like banner ("Added to downloads", errors) */
  banner: string | null;

  ensureStream: () => void;
  stopStream: () => void;
  setJobs: (jobs: DownloadJob[]) => void;
  create: (track: { id: string; title?: string }, container: string, quality: string) => Promise<DownloadJob>;
  cancel: (id: string) => Promise<void>;
  clearBanner: () => void;
}

let cancelStream: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  jobs: {},
  connected: false,
  banner: null,

  setJobs: (jobs) => {
    const map: Record<string, DownloadJob> = {};
    for (const j of jobs) map[j.id] = j;
    set({ jobs: map });
  },

  ensureStream: () => {
    if (cancelStream) return; // already live
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    cancelStream = api.downloads.stream(
      (jobs) => get().setJobs(jobs),
      () => {
        cancelStream = null;
        set({ connected: false });
        // Reconnect with backoff while the tab is alive.
        retryTimer = setTimeout(() => {
          retryTimer = null;
          get().ensureStream();
        }, 4000);
      },
    );
    set({ connected: true });
  },

  stopStream: () => {
    cancelStream?.();
    cancelStream = null;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    set({ connected: false });
  },

  create: async (track, container, quality) => {
    const { job } = await api.downloads.create({
      video_id: track.id,
      container,
      quality,
      title: track.title,
    });
    set((s) => ({ jobs: { ...s.jobs, [job.id]: job }, banner: `Downloading “${track.title}”` }));
    get().ensureStream();
    return job;
  },

  cancel: async (id) => {
    const { job } = await api.downloads.cancel(id);
    set((s) => ({ jobs: { ...s.jobs, [job.id]: job } }));
  },

  clearBanner: () => set({ banner: null }),
}));

/** Selector helper — active job rows sorted newest-first. */
export function activeJobs(jobs: Record<string, DownloadJob>): DownloadJob[] {
  return Object.values(jobs)
    .filter((j) => j.status === "queued" || j.status === "downloading" || j.status === "processing")
    .sort((a, b) => b.created_at - a.created_at);
}

export function doneJobs(jobs: Record<string, DownloadJob>): DownloadJob[] {
  return Object.values(jobs)
    .filter((j) => j.status === "completed" || j.status === "failed")
    .sort((a, b) => b.updated_at - a.updated_at);
}
