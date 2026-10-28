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

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function isCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() ?? cap?.getPlatform?.() === "android");
}

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
  save(options: { name: string; base64: string }): Promise<{ uri?: string; path?: string }>;
}

export async function saveJobToDownloads(job: DownloadJob): Promise<SaveOutcome> {
  if (!isCapacitor()) return "unavailable";
  try {
    const res = await fetch(api.fileUrl(job.id));
    if (!res.ok) throw new Error(`gateway returned ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { registerPlugin } = await import("@capacitor/core");
    const saver = registerPlugin<DownloadSaverPlugin>("DownloadSaver");
    await saver.save({ name: downloadFileName(job), base64: bytesToBase64(bytes) });
    return "saved";
  } catch (err) {
    console.warn("[capacitor] save to Downloads failed", err);
    return "unavailable";
  }
}

export type BackAction = "collapse-player" | "close-queue" | "close-sidebar" | "exit";

/** Pure decision for the Android hardware back button (unit-tested). */
export function resolveBackAction(input: {
  playerExpanded: boolean;
  queueOpen: boolean;
  sidebarOpen: boolean;
}): BackAction {
  if (input.playerExpanded) return "collapse-player";
  if (input.queueOpen) return "close-queue";
  if (input.sidebarOpen) return "close-sidebar";
  return "exit";
}
