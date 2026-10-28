/**
 * Capacitor (Android) integration points — no-ops everywhere else.
 *
 * - Detection via the injected Capacitor bridge (Android WebView origin is
 *   https://localhost; API traffic goes to the LAN gateway, mixed content is
 *   enabled in capacitor.config.json).
 * - Scoped-storage downloads: finished jobs are fetched from the gateway and
 *   handed to the custom `DownloadSaver` native plugin
 *   (mobile/android/.../DownloadSaver.java), which writes through
 *   MediaStore.Downloads on Android 10+ (no permissions) and falls back to
 *   the legacy public Downloads folder on Android 9− (manifest permission is
 *   capped at SDK 28).
 * - Hardware back button: closes player/queue layers first, exits last.
 */
import type { DownloadJob } from "@themashup/shared";
import { api } from "./api";
import type { SaveOutcome } from "./desktop";

export { isCapacitor } from "./bridge";
import { isCapacitor } from "./bridge";

/** Base64 without stack-overflowing String.fromCharCode.apply on big files. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function downloadFileName(job: DownloadJob): string {
  const base = (job.title || job.video_id).replace(/[^\w .-]+/g, "_").slice(0, 60);
  return `${base}.${job.container}`;
}

/**
 * Save a finished job into the device's Downloads (scoped storage).
 * Returns "unavailable" off-device or on failure so callers fall back.
 */
interface DownloadSaverPlugin {
  /** Streams <url> to the shared Downloads collection natively. */
  download(options: { url: string; name: string }): Promise<{ uri?: string; path?: string }>;
}

export async function saveJobToDownloads(job: DownloadJob): Promise<SaveOutcome> {
  if (!isCapacitor()) return "unavailable";
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const saver = registerPlugin<DownloadSaverPlugin>("DownloadSaver");
    // Identity rides in the query string (fileUrl) — native HTTP, no CORS.
    await saver.download({ url: api.fileUrl(job.id), name: downloadFileName(job) });
    return "saved";
  } catch (err) {
    console.warn("[capacitor] save to Downloads failed", err);
    return "unavailable";
  }
}

export type BackDecision =
  | "collapse-player"
  | "close-queue"
  | "close-sidebar"
  | "navigate"
  | "go-home"
  | "none";

/**
 * Pure decision for the Android hardware back button (unit-tested).
 *
 * Priority: dismiss open layers → double-press (≤400 ms after a navigation)
 * jumps straight to Home → single press goes to the previous section →
 * at Home with no history the press does nothing (the system gesture
 * handles leaving the app; back never force-closes).
 */
export function decideBackPress(input: {
  playerExpanded: boolean;
  queueOpen: boolean;
  sidebarOpen: boolean;
  page: string;
  historyLen: number;
  msSinceLastNavigate: number | null;
}): BackDecision {
  if (input.playerExpanded) return "collapse-player";
  if (input.queueOpen) return "close-queue";
  if (input.sidebarOpen) return "close-sidebar";
  if (
    input.msSinceLastNavigate !== null &&
    input.msSinceLastNavigate >= 0 &&
    input.msSinceLastNavigate <= 400
  ) {
    return "go-home";
  }
  if (input.historyLen > 0) return "navigate";
  if (input.page !== "home") return "go-home";
  return "none";
}
