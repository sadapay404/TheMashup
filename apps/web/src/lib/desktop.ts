/**
 * Desktop (Tauri) integration points — everything degrades to no-ops on the web.
 *
 * The Rust shell (desktop/src-tauri) forwards tray menu and system media-key
 * presses as `player-action` events; downloads gain a native Save dialog that
 * writes gateway bytes to a user-chosen path via the fs plugin.
 */
import type { DownloadJob } from "@themashup/shared";
import { api } from "./api";

export type PlayerAction = "toggle" | "next" | "prev";

/** True inside the Tauri webview (v2 schemes: tauri: / http://tauri.localhost). */
export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const loc = window.location;
  return loc.protocol === "tauri:" || loc.hostname === "tauri.localhost";
}

/** Subscribe to tray / global-shortcut actions. Returns an unsubscribe fn. */
export async function onPlayerAction(
  cb: (action: PlayerAction) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<string>("player-action", (ev) => {
      if (ev.payload === "toggle" || ev.payload === "next" || ev.payload === "prev") {
        cb(ev.payload);
      }
    });
  } catch (err) {
    console.warn("[desktop] player-action listener unavailable", err);
    return () => undefined;
  }
}

export type SaveOutcome = "saved" | "cancelled" | "unavailable";

/**
 * Desktop-only native save: dialog for the target path, then stream the
 * finished job's bytes from the gateway into that file. Returns "unavailable"
 * when not in Tauri (or on any plugin failure) so callers can fall back to
 * the plain browser download.
 */
export async function saveJobFile(job: DownloadJob): Promise<SaveOutcome> {
  if (!isDesktop()) return "unavailable";
  try {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const fallback = `${(job.title || job.video_id).replace(/[^\w .-]+/g, "_")}.${job.container}`;
    const base = job.filename ? (job.filename.split(/[\\/]/).pop() ?? fallback) : fallback;
    const path = await save({
      defaultPath: base,
      filters: [{ name: job.container.toUpperCase(), extensions: [job.container] }],
    });
    if (!path) return "cancelled";

    const res = await fetch(api.fileUrl(job.id));
    if (!res.ok) throw new Error(`gateway returned ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeFile(path, bytes);
    return "saved";
  } catch (err) {
    console.warn("[desktop] native save failed", err);
    return "unavailable";
  }
}
