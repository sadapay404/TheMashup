/**
 * LRCLIB client — the only lyrics transport.
 * Contract verified by reading the real server source (tranxuanthang/lrclib):
 *   GET /api/get?track_name&artist_name&album_name&duration  → single best match
 *   GET /api/search?q= | track_name= | artist_name=           → title/artist/album matches only
 *   CORS: Access-Control-Allow-Origin: *
 * Returns camelCase fields: trackName, artistName, plainLyrics, syncedLyrics, hasWordSync…
 */

import type { Lyrics } from '../domain.js';
import { parseSyncedLyrics } from './lrc.js';
import { err, ok, type Result, toAppError } from '../util/result.js';

const BASE = 'https://lrclib.net/api';

export interface LrclibRecord {
  id: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  hasWordSync?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** Identifies this client politely — LRCLIB asks consumers to send a UA. Brains are not tracked. */
const CLIENT_HEADER = { 'Lrclib-Client': 'TheMashup v0.2 (https://github.com/sadapay404/TheMashup)' };

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: CLIENT_HEADER, signal: signal ?? null });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return res.json();
}

export function toLyrics(rec: LrclibRecord | null): Lyrics | null {
  if (!rec) return null;
  const synced = rec.syncedLyrics ? parseSyncedLyrics(rec.syncedLyrics) : [];
  return {
    plain: rec.plainLyrics ?? null,
    synced: synced.length ? synced : null,
    instrumental: rec.instrumental === true,
    source: 'LRCLIB',
  };
}

/** Exact-ish lookup by metadata. `duration` narrows covers/remixes dramatically. */
export async function getLyrics(
  trackName: string,
  artistName: string,
  opts: { albumName?: string; durationSec?: number; signal?: AbortSignal } = {},
): Promise<Result<Lyrics | null>> {
  const qs = new URLSearchParams({ track_name: trackName, artist_name: artistName });
  if (opts.albumName) qs.set('album_name', opts.albumName);
  if (opts.durationSec && opts.durationSec > 1) qs.set('duration', String(Math.round(opts.durationSec)));
  try {
    const json = await getJson(`${BASE}/get?${qs.toString()}`, opts.signal);
    return ok(toLyrics(json as LrclibRecord | null));
  } catch (e) {
    return err(toAppError(e, 'lrclib/get'));
  }
}

/**
 * Search by title/artist/album ONLY (not lyric text — see Amendment A-2).
 * Used to disambiguate candidates produced by the local index or the upstream fallback.
 */
export async function searchLyrics(
  params: { q?: string; trackName?: string; artistName?: string },
  signal?: AbortSignal,
): Promise<Result<LrclibRecord[]>> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.trackName) qs.set('track_name', params.trackName);
  if (params.artistName) qs.set('artist_name', params.artistName);
  if (![...qs.keys()].length) return ok([]);
  try {
    const json = await getJson(`${BASE}/search?${qs.toString()}`, signal);
    const list = Array.isArray(json) ? json : [];
    return ok(list as LrclibRecord[]);
  } catch (e) {
    return err(toAppError(e, 'lrclib/search'));
  }
}
