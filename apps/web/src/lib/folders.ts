/**
 * Download folders.
 *
 * The user's model is a file manager: folders on top, files below, and any file can be moved from
 * one folder to another. That works whether or not the platform can create real directories, so
 * this module owns the rules and the store owns the data.
 *
 * Two buckets are fixed — one for music, one for video — because the user asked for videos in a
 * separate section. Everything else is a folder the user or a playlist created.
 */

import { store, type DownloadFolder, type MediaKind } from '@/state/store';
import { isNative, nativeMoveFile } from './native';

export const SYSTEM_FOLDER: Record<MediaKind, string> = {
  music: 'all-songs',
  video: 'all-videos',
};

export const DEFAULT_FOLDER_NAME: Record<MediaKind, string> = {
  music: 'All songs',
  video: 'Videos',
};

/** Filesystem-safe folder name. Mirrors the native side so names match on disk. */
export function safeFolderName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120);
  return cleaned || 'Untitled';
}

/**
 * Find a folder by name within a kind, or create it.
 *
 * Matching is case-insensitive so "Jhol" and "jhol" do not become two folders holding half the same
 * album. A playlist download calls this once and every track in it lands together.
 */
export function ensureFolder(name: string, kind: MediaKind): DownloadFolder {
  const wanted = safeFolderName(name);
  const state = store.getState();
  const existing = state.folders.find(
    (f) => f.kind === kind && f.name.toLowerCase() === wanted.toLowerCase(),
  );
  if (existing) return existing;

  const folder: DownloadFolder = {
    id: `f-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: wanted,
    kind,
    createdAt: Date.now(),
  };
  store.set((s) => ({ folders: [...s.folders, folder] }));
  return folder;
}

export function folderById(id: string | null | undefined): DownloadFolder | null {
  if (!id) return null;
  return store.getState().folders.find((f) => f.id === id) ?? null;
}

/** Folders for one section, system bucket first, then oldest first so order is stable. */
export function foldersOf(kind: MediaKind): DownloadFolder[] {
  const list = store.getState().folders.filter((f) => f.kind === kind);
  return list.sort((a, b) => {
    if (Boolean(a.system) !== Boolean(b.system)) return a.system ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
}

/**
 * Stored files in a folder, newest first.
 *
 * Only `done` jobs count. A download that is still moving, or that failed, lives in the section's
 * in-progress list instead — otherwise the same row appears in two places at once and the folder
 * claims to hold a file that is not on disk.
 */
export function filesIn(folderId: string): ReturnType<typeof store.getState>['downloads'] {
  return store
    .getState()
    .downloads.filter(
      (j) => j.state === 'done' && (j.folderId ?? SYSTEM_FOLDER[j.kind ?? 'music']) === folderId,
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** How many completed files a folder holds — a system bucket stays even when empty. */
export function fileCount(folderId: string): number {
  return store.getState().downloads.filter((j) => j.folderId === folderId && j.state === 'done').length;
}

/**
 * Move files into a folder.
 *
 * Moves are metadata-only on purpose: the bytes are already written, and re-writing them to change
 * which folder they sit in would risk a half-moved file for no benefit. The native side is told so
 * the real directory is updated when files live on disk.
 */
export function moveToFolder(
  ids: string[],
  folderId: string,
): { moved: number; folder: DownloadFolder | null } {
  const folder = folderById(folderId);
  if (!folder) return { moved: 0, folder: null };

  const wanted = new Set(ids);
  let moved = 0;
  store.set((s) => ({
    downloads: s.downloads.map((j) => {
      if (!wanted.has(j.id)) return j;
      if (j.folderId === folderId) return j;
      // A folder belongs to one section; filing music into a video folder would put a song in the
      // wrong list, so a mismatched kind is left where it is rather than silently reclassified.
      if ((j.kind ?? 'music') !== folder.kind) return j;
      moved += 1;
      return { ...j, folderId };
    }),
  }));

  return { moved, folder };
}

/**
 * Move the bytes as well as the record, on platforms where the file exists.
 *
 * Separate from `moveToFolder` because it is asynchronous and can fail, and a caller that ignores it
 * would show a success message for a file that never moved. Resolves to the number of files that
 * could not be moved; the browser has no filesystem here, so it always resolves to 0.
 */
export async function syncFolderToDisk(ids: string[], folderId: string): Promise<number> {
  if (!isNative()) return 0;
  const folder = folderById(folderId);
  if (!folder) return 0;

  let failed = 0;
  for (const id of ids) {
    const job = store.getState().downloads.find((j) => j.id === id);
    // No `path` means the file never reached disk (browser-saved or still moving), so there is
    // nothing to relocate and nothing to report.
    if (!job?.path) continue;
    if ((job.kind ?? 'music') !== folder.kind) continue;

    const next = await nativeMoveFile({
      from: job.path,
      fromKind: job.kind ?? 'music',
      toFolder: folder.name,
      toKind: folder.kind,
    });
    if (!next) {
      failed += 1;
      continue;
    }
    store.set((s) => ({
      downloads: s.downloads.map((j) => (j.id === id ? { ...j, path: next } : j)),
    }));
  }
  return failed;
}

/** Rename a user folder. System buckets keep their names. */
export function renameFolder(id: string, name: string): boolean {
  const folder = folderById(id);
  if (!folder || folder.system) return false;
  // Blank is rejected, not defaulted: silently creating "Untitled" hides the mistake behind a name
  // the user never typed.
  if (!name.trim()) return false;
  const safe = safeFolderName(name);
  if (safe === folder.name) return false;
  const clash = store
    .getState()
    .folders.some((f) => f.kind === folder.kind && f.id !== id && f.name.toLowerCase() === safe.toLowerCase());
  if (clash) return false;

  store.set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name: safe } : f)) }));
  return true;
}

/**
 * Delete a folder.
 *
 * The files are kept and fall back to their section's system bucket. Deleting a folder is a
 * statement about organisation, not a request to destroy the music inside it — and a destructive
 * "everything in here is gone" default is exactly the kind of thing that should never be a surprise.
 */
export function deleteFolder(id: string): { folded: number } | null {
  const folder = folderById(id);
  if (!folder || folder.system) return null;

  const fallback = SYSTEM_FOLDER[folder.kind];
  let folded = 0;
  store.set((s) => ({
    folders: s.folders.filter((f) => f.id !== id),
    downloads: s.downloads.map((j) => {
      if (j.folderId !== id) return j;
      folded += 1;
      return { ...j, folderId: fallback };
    }),
  }));
  return { folded };
}
