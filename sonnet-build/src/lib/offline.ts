"use client";
import type { Track } from "./types";

export type OfflineRecord = {
  key: string;
  trackId: string;
  track: Track;
  quality: string;
  blob: Blob;
  size: number;
  savedAt: number;
  mime: string;
};

const DB = "themashup-offline";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(STORE, { keyPath: "key" });
      s.createIndex("trackId", "trackId");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function putOffline(rec: OfflineRecord) {
  const db = await open();
  await wrap(db.transaction(STORE, "readwrite").objectStore(STORE).put(rec));
}

export async function listOffline(): Promise<OfflineRecord[]> {
  try {
    const db = await open();
    const all = await wrap(db.transaction(STORE).objectStore(STORE).getAll());
    return (all as OfflineRecord[]).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function getOfflineByTrack(trackId: string): Promise<OfflineRecord | undefined> {
  try {
    const db = await open();
    const all = await wrap(db.transaction(STORE).objectStore(STORE).index("trackId").getAll(trackId));
    return (all as OfflineRecord[])[0];
  } catch {
    return undefined;
  }
}

export async function deleteOffline(key: string) {
  const db = await open();
  await wrap(db.transaction(STORE, "readwrite").objectStore(STORE).delete(key));
}
