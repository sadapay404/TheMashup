import { create } from "zustand";
import type { ArtistRef, PlaylistMeta, Track } from "@themashup/shared";
import { api } from "../lib/api";
import { useSessionStore } from "./sessionStore";

interface LibraryState {
  likes: Track[];
  playlists: PlaylistMeta[];
  history: { track: Track; at: string; context?: string }[];
  follows: ArtistRef[];
  activePlaylist: { meta: PlaylistMeta; tracks: Track[] } | null;
  hydrated: boolean;
  loading: boolean;
  error?: string;

  hydrate: (force?: boolean) => Promise<void>;
  isLiked: (trackId: string) => boolean;
  toggleLike: (track: Track) => Promise<void>;
  createPlaylist: (title: string) => Promise<PlaylistMeta | undefined>;
  deletePlaylist: (id: string) => Promise<void>;
  openPlaylist: (id: string) => Promise<void>;
  closePlaylist: () => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderActivePlaylist: (playlistId: string, trackIds: string[]) => Promise<void>;
  isFollowing: (key: string) => boolean;
  toggleFollow: (artist: ArtistRef) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  likes: [],
  playlists: [],
  history: [],
  follows: [],
  activePlaylist: null,
  hydrated: false,
  loading: false,
  error: undefined,

  hydrate: async (force = false) => {
    const session = useSessionStore.getState();
    if (session.mode === "none" || !session.user) {
      set({ likes: [], playlists: [], history: [], follows: [], hydrated: true, activePlaylist: null });
      return;
    }
    if (get().hydrated && !force) return;
    set({ loading: true, error: undefined });
    const [likes, playlists, history, follows] = await Promise.allSettled([
      api.library.likes(),
      api.library.playlists(),
      api.library.history(),
      api.library.follows(),
    ]);
    const failed = [likes, playlists, history, follows].find((r) => r.status === "rejected");
    set({
      likes: likes.status === "fulfilled" ? likes.value.likes : get().likes,
      playlists: playlists.status === "fulfilled" ? playlists.value.playlists : get().playlists,
      history: history.status === "fulfilled" ? history.value.history : get().history,
      follows: follows.status === "fulfilled" ? follows.value.follows : get().follows,
      hydrated: true,
      loading: false,
      error:
        failed && failed.status === "rejected"
          ? (failed.reason as Error)?.message
          : undefined,
    });
  },

  isLiked: (trackId) => get().likes.some((t) => t.id === trackId),

  toggleLike: async (track) => {
    const liked = get().isLiked(track.id);
    // Optimistic
    set({
      likes: liked ? get().likes.filter((t) => t.id !== track.id) : [track, ...get().likes],
    });
    try {
      if (liked) await api.library.unlike(track.id);
      else await api.library.like(track);
      // Record the sentiment — feeds the recommendation engine.
      api.event({ type: liked ? "dislike" : "like", track_id: track.id, context: "library" });
    } catch (err) {
      // Rollback on failure
      set({
        likes: liked ? [track, ...get().likes.filter((t) => t.id !== track.id)] : get().likes.filter((t) => t.id !== track.id),
      });
      throw err;
    }
  },

  createPlaylist: async (title) => {
    const { playlist } = await api.library.createPlaylist(title);
    set({ playlists: [playlist, ...get().playlists] });
    return playlist;
  },

  deletePlaylist: async (id) => {
    set({ playlists: get().playlists.filter((p) => p.id !== id) });
    if (get().activePlaylist?.meta.id === id) set({ activePlaylist: null });
    await api.library.deletePlaylist(id);
  },

  openPlaylist: async (id) => {
    set({ loading: true });
    const { meta, tracks } = await api.library.playlist(id);
    set({ activePlaylist: { meta, tracks }, loading: false });
  },

  closePlaylist: () => set({ activePlaylist: null }),

  addTrackToPlaylist: async (playlistId, track) => {
    await api.library.addToPlaylist(playlistId, track);
    const active = get().activePlaylist;
    if (active && active.meta.id === playlistId && !active.tracks.some((t) => t.id === track.id)) {
      set({
        activePlaylist: {
          meta: { ...active.meta, track_count: active.tracks.length + 1 },
          tracks: [...active.tracks, track],
        },
      });
    }
    set({
      playlists: get().playlists.map((p) =>
        p.id === playlistId ? { ...p, track_count: p.track_count + 1 } : p,
      ),
    });
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    const active = get().activePlaylist;
    if (active && active.meta.id === playlistId) {
      const tracks = active.tracks.filter((t) => t.id !== trackId);
      set({
        activePlaylist: {
          meta: { ...active.meta, track_count: tracks.length },
          tracks,
        },
      });
    }
    set({
      playlists: get().playlists.map((p) =>
        p.id === playlistId ? { ...p, track_count: Math.max(0, p.track_count - 1) } : p,
      ),
    });
    await api.library.removeFromPlaylist(playlistId, trackId);
  },

  reorderActivePlaylist: async (playlistId, trackIds) => {
    const active = get().activePlaylist;
    if (!active || active.meta.id !== playlistId) return;
    const previous = active.tracks;
    const byId = new Map(previous.map((t) => [t.id, t]));
    const next = trackIds.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
    if (next.length !== previous.length) return;
    // Optimistic — server validates the permutation and confirms.
    set({ activePlaylist: { meta: active.meta, tracks: next } });
    try {
      const { meta, tracks } = await api.library.reorderPlaylist(playlistId, trackIds);
      set({ activePlaylist: { meta, tracks } });
    } catch (err) {
      set({ activePlaylist: { meta: active.meta, tracks: previous } });
      throw err;
    }
  },

  isFollowing: (key) =>
    get().follows.some((f) => (f.channel_id ?? f.name) === key),

  toggleFollow: async (artist) => {
    const key = artist.channel_id ?? artist.name;
    const wasFollowing = get().isFollowing(key);
    set({
      follows: wasFollowing
        ? get().follows.filter((f) => (f.channel_id ?? f.name) !== key)
        : [artist, ...get().follows],
    });
    try {
      if (wasFollowing) await api.library.unfollow(key);
      else await api.library.follow(artist);
    } catch (err) {
      set({
        follows: wasFollowing
          ? [artist, ...get().follows]
          : get().follows.filter((f) => (f.channel_id ?? f.name) !== key),
      });
      throw err;
    }
  },
}));
