/**
 * Library persistence backends.
 *
 * - LocalJsonBackend: zero-setup JSON file store (Phase 4 default until the
 *   user creates a Supabase project). Atomic writes, per-user namespaces.
 * - SupabaseBackend: activates automatically when SUPABASE_URL +
 *   SUPABASE_SERVICE_ROLE_KEY are set. Same interface, SQL migration in
 *   `supabase/migrations/0001_init.sql`.
 *
 * Tracks are stored denormalized (`track_snapshot`) so the UI renders
 * instantly without catalog joins; `ensureTrack` keeps the catalog cache warm.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ArtistRef,
  HistoryEntry,
  ListeningEvent,
  PlaylistMeta,
  Track,
} from "@themashup/shared";
import { config } from "../config.js";
import { log } from "../logger.js";
import { supabaseAdmin } from "../middleware/auth.js";


export interface LibraryBackend {
  readonly kind: "local" | "supabase";

  listLikes(userId: string): Promise<Track[]>;
  setLike(userId: string, track: Track, kind: "up" | "down"): Promise<void>;
  removeLike(userId: string, trackId: string): Promise<void>;

  listHistory(userId: string, limit: number): Promise<HistoryEntry[]>;
  recordEvent(userId: string, event: ListeningEvent, track: Track): Promise<void>;

  listPlaylists(userId: string): Promise<PlaylistMeta[]>;
  createPlaylist(userId: string, title: string, description?: string): Promise<PlaylistMeta>;
  deletePlaylist(userId: string, playlistId: string): Promise<void>;
  getPlaylist(userId: string, playlistId: string): Promise<{ meta: PlaylistMeta; tracks: Track[] }>;
  addToPlaylist(userId: string, playlistId: string, track: Track): Promise<void>;
  removeFromPlaylist(userId: string, playlistId: string, trackId: string): Promise<void>;
  /** Persist a drag-and-drop reorder: trackIds must be a permutation of current tracks. */
  reorderPlaylist(userId: string, playlistId: string, trackIds: string[]): Promise<void>;

  listFollows(userId: string): Promise<ArtistRef[]>;
  follow(userId: string, artist: ArtistRef): Promise<void>;
  unfollow(userId: string, channelOrName: string): Promise<void>;
}

/* ─────────────────────────── Local JSON ─────────────────────────── */

interface LocalData {
  users: Record<
    string,
    {
      likes: { track: Track; kind: string; at: string }[];
      history: HistoryEntry[];
      playlists: { meta: PlaylistMeta; tracks: Track[] }[];
      follows: { artist: ArtistRef; at: string }[];
    }
  >;
}

function emptyUser(): LocalData["users"][string] {
  return { likes: [], history: [], playlists: [], follows: [] };
}

const HISTORY_CAP = 300;
const PLAYLIST_CAP = 100;

class LocalJsonBackend implements LibraryBackend {
  readonly kind = "local" as const;
  private data: LocalData | null = null;
  private readonly file: string;

  constructor(file: string) {
    this.file = path.resolve(file);
  }

  private load(): LocalData {
    if (this.data) return this.data;
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, "utf8")) as LocalData;
      }
    } catch (err) {
      log.warn("library db unreadable — starting fresh", err);
    }
    this.data ??= { users: {} };
    return this.data;
  }

  private user(userId: string): LocalData["users"][string] {
    const data = this.load();
    data.users[userId] ??= emptyUser();
    return data.users[userId];
  }

  private save(): void {
    const data = this.load();
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      log.error("library db write failed", err);
    }
  }

  async listLikes(userId: string): Promise<Track[]> {
    return this.user(userId).likes.map((l) => l.track);
  }

  async setLike(userId: string, track: Track, kind: "up" | "down"): Promise<void> {
    const u = this.user(userId);
    u.likes = u.likes.filter((l) => l.track.id !== track.id);
    u.likes.unshift({ track, kind, at: new Date().toISOString() });
    this.save();
  }

  async removeLike(userId: string, trackId: string): Promise<void> {
    const u = this.user(userId);
    u.likes = u.likes.filter((l) => l.track.id !== trackId);
    this.save();
  }

  async listHistory(userId: string, limit: number): Promise<HistoryEntry[]> {
    return this.user(userId).history.slice(0, limit);
  }

  async recordEvent(userId: string, event: ListeningEvent, track: Track): Promise<void> {
    if (event.type !== "play" && event.type !== "complete" && event.type !== "skip") return;
    const u = this.user(userId);
    // Recency-dedupe: same track moves to the front instead of duplicating.
    u.history = u.history.filter((h) => h.track.id !== track.id);
    u.history.unshift({ track, at: new Date().toISOString(), context: event.context });
    if (u.history.length > HISTORY_CAP) u.history.length = HISTORY_CAP;
    this.save();
  }

  async listPlaylists(userId: string): Promise<PlaylistMeta[]> {
    return this.user(userId)
      .playlists.map((p) => p.meta)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async createPlaylist(userId: string, title: string, description?: string): Promise<PlaylistMeta> {
    const now = new Date().toISOString();
    const meta: PlaylistMeta = {
      id: crypto.randomUUID(),
      title,
      description,
      track_count: 0,
      created_at: now,
      updated_at: now,
    };
    this.user(userId).playlists.unshift({ meta, tracks: [] });
    this.save();
    return meta;
  }

  async deletePlaylist(userId: string, playlistId: string): Promise<void> {
    const u = this.user(userId);
    u.playlists = u.playlists.filter((p) => p.meta.id !== playlistId);
    this.save();
  }

  async getPlaylist(
    userId: string,
    playlistId: string,
  ): Promise<{ meta: PlaylistMeta; tracks: Track[] }> {
    const found = this.user(userId).playlists.find((p) => p.meta.id === playlistId);
    if (!found) throw Object.assign(new Error("playlist not found"), { status: 404 });
    return { meta: { ...found.meta, track_count: found.tracks.length }, tracks: [...found.tracks] };
  }

  async addToPlaylist(userId: string, playlistId: string, track: Track): Promise<void> {
    const found = this.user(userId).playlists.find((p) => p.meta.id === playlistId);
    if (!found) throw Object.assign(new Error("playlist not found"), { status: 404 });
    if (found.tracks.some((t) => t.id === track.id)) return;
    if (found.tracks.length >= PLAYLIST_CAP) return;
    found.tracks.push(track);
    found.meta.track_count = found.tracks.length;
    found.meta.updated_at = new Date().toISOString();
    if (!found.meta.cover_url) found.meta.cover_url = track.artwork_best ?? track.artwork;
    this.save();
  }

  async removeFromPlaylist(userId: string, playlistId: string, trackId: string): Promise<void> {
    const found = this.user(userId).playlists.find((p) => p.meta.id === playlistId);
    if (!found) throw Object.assign(new Error("playlist not found"), { status: 404 });
    found.tracks = found.tracks.filter((t) => t.id !== trackId);
    found.meta.track_count = found.tracks.length;
    found.meta.updated_at = new Date().toISOString();
    this.save();
  }

  async reorderPlaylist(userId: string, playlistId: string, trackIds: string[]): Promise<void> {
    const found = this.user(userId).playlists.find((p) => p.meta.id === playlistId);
    if (!found) throw Object.assign(new Error("playlist not found"), { status: 404 });
    const byId = new Map(found.tracks.map((t) => [t.id, t]));
    const valid =
      new Set(trackIds).size === trackIds.length &&
      trackIds.length === found.tracks.length &&
      trackIds.every((id) => byId.has(id));
    if (!valid) {
      throw Object.assign(new Error("track_ids must be a permutation of the playlist"), {
        status: 400,
      });
    }
    found.tracks = trackIds.map((id) => byId.get(id)!);
    found.meta.updated_at = new Date().toISOString();
    this.save();
  }

  async listFollows(userId: string): Promise<ArtistRef[]> {
    return this.user(userId).follows.map((f) => f.artist);
  }

  async follow(userId: string, artist: ArtistRef): Promise<void> {
    const u = this.user(userId);
    const key = artist.channel_id ?? artist.name;
    u.follows = u.follows.filter((f) => (f.artist.channel_id ?? f.artist.name) !== key);
    u.follows.unshift({ artist, at: new Date().toISOString() });
    this.save();
  }

  async unfollow(userId: string, channelOrName: string): Promise<void> {
    const u = this.user(userId);
    u.follows = u.follows.filter(
      (f) => (f.artist.channel_id ?? f.artist.name) !== channelOrName,
    );
    this.save();
  }
}

/* ─────────────────────────── Supabase ───────────────────────────── */

class SupabaseBackend implements LibraryBackend {
  readonly kind = "supabase" as const;
  private client() {
    const admin = supabaseAdmin();
    if (!admin) throw new Error("Supabase not configured");
    return admin;
  }

  private async ensureTrack(track: Track): Promise<void> {
    const { error } = await this.client().from("tracks").upsert(
      {
        external_id: track.id,
        source: track.source,
        title: track.title,
        artist_names: track.artist_names,
        album: track.album ?? null,
        duration_sec: track.duration_sec ?? null,
        artwork_url: track.artwork_best ?? track.artwork ?? null,
        payload: track,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "external_id" },
    );
    if (error) log.warn("ensureTrack failed", error.message);
  }

  async listLikes(userId: string): Promise<Track[]> {
    const { data, error } = await this.client()
      .from("likes")
      .select("track_snapshot")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.track_snapshot as Track);
  }

  async setLike(userId: string, track: Track, kind: "up" | "down"): Promise<void> {
    await this.ensureTrack(track);
    const { error } = await this.client().from("likes").upsert(
      {
        user_id: userId,
        track_external_id: track.id,
        track_snapshot: track,
        kind,
        created_at: new Date().toISOString(),
      },
      { onConflict: "user_id,track_external_id" },
    );
    if (error) throw new Error(error.message);
  }

  async removeLike(userId: string, trackId: string): Promise<void> {
    const { error } = await this.client()
      .from("likes")
      .delete()
      .eq("user_id", userId)
      .eq("track_external_id", trackId);
    if (error) throw new Error(error.message);
  }

  async listHistory(userId: string, limit: number): Promise<HistoryEntry[]> {
    const { data, error } = await this.client()
      .from("play_events")
      .select("track_snapshot, context, created_at, event_type")
      .eq("user_id", userId)
      .in("event_type", ["play", "complete", "skip"])
      .order("created_at", { ascending: false })
      .limit(limit * 3);
    if (error) throw new Error(error.message);
    const seen = new Set<string>();
    const out: HistoryEntry[] = [];
    for (const r of data ?? []) {
      const track = r.track_snapshot as Track;
      if (!track || seen.has(track.id)) continue;
      seen.add(track.id);
      out.push({ track, at: r.created_at, context: r.context ?? undefined });
      if (out.length >= limit) break;
    }
    return out;
  }

  async recordEvent(userId: string, event: ListeningEvent, track: Track): Promise<void> {
    await this.ensureTrack(track);
    const { error } = await this.client().from("play_events").insert({
      user_id: userId,
      event_type: event.type,
      track_external_id: track.id,
      track_snapshot: track,
      listened_ms: event.listened_ms ?? null,
      context: event.context ?? null,
      created_at: new Date().toISOString(),
    });
    if (error) log.warn("recordEvent failed", error.message);
  }

  async listPlaylists(userId: string): Promise<PlaylistMeta[]> {
    const { data, error } = await this.client()
      .from("playlists")
      .select("id, title, description, cover_url, created_at, updated_at, playlist_tracks(id)")
      .eq("owner_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description ?? undefined,
      cover_url: p.cover_url ?? undefined,
      track_count: (p.playlist_tracks as unknown[] | null)?.length ?? 0,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));
  }

  async createPlaylist(userId: string, title: string, description?: string): Promise<PlaylistMeta> {
    const now = new Date().toISOString();
    const { data, error } = await this.client()
      .from("playlists")
      .insert({ owner_id: userId, title, description: description ?? null, created_at: now, updated_at: now })
      .select("id, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: data.id,
      title,
      description,
      track_count: 0,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  async deletePlaylist(userId: string, playlistId: string): Promise<void> {
    const { error } = await this.client()
      .from("playlists")
      .delete()
      .eq("id", playlistId)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
  }

  async getPlaylist(
    userId: string,
    playlistId: string,
  ): Promise<{ meta: PlaylistMeta; tracks: Track[] }> {
    const { data: pl, error } = await this.client()
      .from("playlists")
      .select("id, title, description, cover_url, created_at, updated_at")
      .eq("id", playlistId)
      .eq("owner_id", userId)
      .single();
    if (error || !pl) throw Object.assign(new Error("playlist not found"), { status: 404 });
    const { data: rows, error: rowsErr } = await this.client()
      .from("playlist_tracks")
      .select("track_snapshot, position")
      .eq("playlist_id", playlistId)
      .order("position", { ascending: true });
    if (rowsErr) throw new Error(rowsErr.message);
    return {
      meta: {
        id: pl.id,
        title: pl.title,
        description: pl.description ?? undefined,
        cover_url: pl.cover_url ?? undefined,
        track_count: (rows ?? []).length,
        created_at: pl.created_at,
        updated_at: pl.updated_at,
      },
      tracks: (rows ?? []).map((r) => r.track_snapshot as Track),
    };
  }

  async addToPlaylist(userId: string, playlistId: string, track: Track): Promise<void> {
    await this.ensureTrack(track);
    const { count } = await this.client()
      .from("playlist_tracks")
      .select("id", { count: "exact", head: true })
      .eq("playlist_id", playlistId);
    const { error } = await this.client().from("playlist_tracks").upsert(
      {
        playlist_id: playlistId,
        track_external_id: track.id,
        track_snapshot: track,
        position: (count ?? 0) + 1,
        added_at: new Date().toISOString(),
      },
      { onConflict: "playlist_id,track_external_id" },
    );
    if (error) throw new Error(error.message);
    await this.client()
      .from("playlists")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", playlistId)
      .eq("owner_id", userId);
  }

  async removeFromPlaylist(userId: string, playlistId: string, trackId: string): Promise<void> {
    const { error } = await this.client()
      .from("playlist_tracks")
      .delete()
      .eq("playlist_id", playlistId)
      .eq("track_external_id", trackId);
    if (error) throw new Error(error.message);
    await this.client()
      .from("playlists")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", playlistId)
      .eq("owner_id", userId);
  }

  async reorderPlaylist(userId: string, playlistId: string, trackIds: string[]): Promise<void> {
    const { data: rows, error } = await this.client()
      .from("playlist_tracks")
      .select("track_external_id")
      .eq("playlist_id", playlistId);
    if (error) throw new Error(error.message);
    const current = (rows ?? []).map((r) => r.track_external_id);
    const valid =
      new Set(trackIds).size === trackIds.length &&
      trackIds.length === current.length &&
      trackIds.every((id) => current.includes(id));
    if (!valid) {
      throw Object.assign(new Error("track_ids must be a permutation of the playlist"), {
        status: 400,
      });
    }
    for (let i = 0; i < trackIds.length; i++) {
      const { error: uerr } = await this.client()
        .from("playlist_tracks")
        .update({ position: i })
        .eq("playlist_id", playlistId)
        .eq("track_external_id", trackIds[i]);
      if (uerr) throw new Error(uerr.message);
    }
    await this.client()
      .from("playlists")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", playlistId)
      .eq("owner_id", userId);
  }

  async listFollows(userId: string): Promise<ArtistRef[]> {
    const { data, error } = await this.client()
      .from("follows")
      .select("artist_snapshot")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.artist_snapshot as ArtistRef);
  }

  async follow(userId: string, artist: ArtistRef): Promise<void> {
    const { error } = await this.client().from("follows").upsert(
      {
        user_id: userId,
        artist_channel_id: artist.channel_id ?? artist.name,
        artist_snapshot: artist,
        created_at: new Date().toISOString(),
      },
      { onConflict: "user_id,artist_channel_id" },
    );
    if (error) throw new Error(error.message);
  }

  async unfollow(userId: string, channelOrName: string): Promise<void> {
    const { error } = await this.client()
      .from("follows")
      .delete()
      .eq("user_id", userId)
      .eq("artist_channel_id", channelOrName);
    if (error) throw new Error(error.message);
  }
}

/* ─────────────────────────── Factory ────────────────────────────── */

let backend: LibraryBackend | null = null;

export function libraryDb(): LibraryBackend {
  if (backend) return backend;
  if (supabaseAdmin()) {
    log.info("library backend: Supabase");
    backend = new SupabaseBackend();
  } else {
    log.info(`library backend: local JSON (${config.libraryDbPath})`);
    backend = new LocalJsonBackend(config.libraryDbPath);
  }
  return backend;
}

/** Test hook: swap backend / reset singleton. */
export function setLibraryBackend(b: LibraryBackend | null): void {
  backend = b;
}
