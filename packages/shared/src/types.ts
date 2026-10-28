/** Unified content types shared by the gateway, resolver and web player. */

export type TrackSource = "ytdlp" | "piped" | "invidious" | "ytmusic";

export interface ArtistRef {
  name: string;
  /** YouTube Music channel id when known. */
  channel_id?: string;
  url?: string;
  image?: string;
}

export interface Track {
  /** Stable id for the client. Until Supabase lands (Phase 4) this IS the source video id. */
  id: string;
  source: TrackSource;
  /** Raw upstream id (YouTube video id). */
  external_id: string;
  title: string;
  artists: ArtistRef[];
  artist_names: string;
  album?: string;
  duration_sec?: number;
  artwork?: string;
  artwork_best?: string;
  popularity?: number;
  explicit?: boolean;
  /** What kind of upstream row this was (search category). */
  category?: "song" | "video" | "album" | "artist" | "playlist" | "top_result";
}

export interface SearchResponse {
  query: string;
  tracks: Track[];
  artists: ArtistRef[];
  albums: { title: string; artist: string; artwork?: string; id?: string }[];
  took_ms: number;
  degraded: boolean;
  warnings: string[];
}

export interface SuggestResponse {
  query: string;
  suggestions: string[];
  took_ms: number;
}

/** One playable rendition of a track, from one source. */
export interface StreamCandidate {
  /** Opaque per-request id used by the gateway proxy token. */
  id: string;
  source: TrackSource;
  /** Direct upstream URL (for native platforms / debugging). */
  url: string;
  /** Same-origin, CORS-safe proxied path for the web player. ALWAYS use this in the browser. */
  play_url: string;
  mime: string;
  ext: string;
  quality: string;
  bitrate_kbps?: number;
  width?: number;
  height?: number;
  has_video: boolean;
  size_bytes?: number;
  /** ISO timestamp after which the upstream URL is likely dead. */
  expires_at?: string;
  /** Upstream headers some CDNs require (referer / user-agent). */
  http_headers?: Record<string, string>;
}

export interface StreamResponse {
  video_id: string;
  candidates: StreamCandidate[];
  resolution_ms: number;
  /** true when the primary source failed and we fell back (or everything failed). */
  degraded: boolean;
  warnings: string[];
}

export interface FormatOption {
  format_id: string;
  ext: string;
  quality: string;
  bitrate_kbps?: number;
  width?: number;
  height?: number;
  has_video: boolean;
  /** Container the download manager should remux/transcode to for the UI option. */
  target_container: "mp3" | "flac" | "opus" | "mp4";
 filesize_bytes?: number;
}

export interface FormatManifest {
  video_id: string;
  title: string;
  duration_sec?: number;
  audio: FormatOption[];
  video: FormatOption[];
}

export interface TrackDetail extends Track {
  related: Track[];
  has_synced_lyrics?: boolean;
}

/** LRC line: seconds-since-start + text. */
export interface LyricLine {
  time: number;
  text: string;
}

export interface Lyrics {
  track_id?: string;
  plain?: string;
  synced?: LyricLine[];
  provider: "lrclib" | "mock";
  instrumental?: boolean;
}

export interface LyricMatch {
  query: string;
  /** Ranked candidates resolving free text (or title/artist) to a track + lyrics. */
  matches: {
    track_name: string;
    artist_name: string;
    album_name?: string;
    duration_sec?: number;
    synced: boolean;
    plain: boolean;
    similarity: number;
    lrclib_id: number;
    /** Best-matching lyric line (shown as the "matched lyric" snippet). */
    snippet?: string;
  }[];
  took_ms: number;
}

export interface RadioRequest {
  seed_video_id?: string;
  query?: string;
  limit?: number;
}

export interface RadioResponse {
  seed?: Track;
  tracks: Track[];
  mode: "seed" | "query";
  generated_at: string;
}

export type DownloadStatus = "queued" | "downloading" | "processing" | "completed" | "failed";

export interface DownloadJob {
  id: string;
  video_id: string;
  title: string;
  container: "mp3" | "flac" | "opus" | "mp4";
  quality: string;
  status: DownloadStatus;
  progress: number;
  speed_bps?: number | null;
  eta_s?: number | null;
  filesize?: number | null;
  filename?: string | null;
  error?: string | null;
  warning?: string | null;
  owner?: string;
  created_at: number;
  updated_at: number;
}

export interface RecShelf {
  kind: "quick" | "discover" | "trending" | "listen_again";
  title: string;
  tracks: Track[];
  /** Empty until Phase 4 personalization. */
  personalized: boolean;
}

export type ListeningEventType =
  | "play"
  | "skip"
  | "complete"
  | "repeat"
  | "like"
  | "dislike";

export interface ListeningEvent {
  type: ListeningEventType;
  track_id: string;
  listened_ms?: number;
  context?: "radio" | "queue" | "search" | "playlist" | "home" | "library";
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
}

export interface PlaylistMeta {
  id: string;
  title: string;
  description?: string;
  cover_url?: string;
  track_count: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryEntry {
  track: Track;
  at: string;
  context?: string;
}
