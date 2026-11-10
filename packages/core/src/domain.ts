/** Canonical domain objects. Everything downstream of the parsers speaks these types. */

export type TrackId = string;

export interface Thumb {
  url: string;
  width: number;
  height: number;
}

export interface Track {
  id: TrackId;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  durationSec: number;
  thumbs: Thumb[];
  /** Present when the source returns an explicit badge (e.g. "Song", "Video"). */
  kind?: 'song' | 'video' | 'episode';
  explicit?: boolean;
  /** Provenance, used for the "why this track" surface and for debugging. */
  source?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year?: number;
  thumbs: Thumb[];
  trackCount?: number;
}

export interface Artist {
  id: string;
  name: string;
  thumbs: Thumb[];
  subscriberCount?: string;
}

export interface Playlist {
  id: string;
  title: string;
  author?: string;
  trackCount?: number;
  thumbs: Thumb[];
}

export type SearchSection =
  | { kind: 'top'; track: Track }
  | { kind: 'songs'; items: Track[] }
  | { kind: 'albums'; items: Album[] }
  | { kind: 'artists'; items: Artist[] }
  | { kind: 'playlists'; items: Playlist[] };

export interface SearchResult {
  sections: SearchSection[];
  continuation?: string;
}

/** One rung of the download ladder. */
export interface AudioFormat {
  itag: number;
  codec: string;
  nominalKbps: number;
  actualKbps: number;
  container: 'm4a' | 'webm';
  quality: string;
  deliver: 'url' | 'cipher' | 'none';
  premiumOnly: boolean;
  /**
   * Length of the audio this format actually delivers, in seconds; 0 when the response omits it.
   * A format much shorter than the track is a preview clip, and playing one sounds like the song
   * stopping dead rather than like a bad connection.
   */
  durationSec: number;
}

export interface VideoFormat {
  itag: number;
  height: number;
  res: string;
  codec: string;
  fps: number;
  kbps: number;
  container: 'mp4' | 'webm';
  hasAudio: boolean;
  deliver: 'url' | 'cipher' | 'none';
}

export interface StreamInfo {
  videoId: string;
  profile: string;
  audio: AudioFormat[];
  video: VideoFormat[];
  expiresInSec: number;
  playability: string;
  /** Direct URLs by itag, only when deliverable without cipher work. */
  urls: Record<number, string>;
}

export interface LyricLine {
  /** Start time in seconds. */
  t: number;
  text: string;
}

export interface Lyrics {
  plain: string | null;
  synced: LyricLine[] | null;
  instrumental: boolean;
  source: string;
}
