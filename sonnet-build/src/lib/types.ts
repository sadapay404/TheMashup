export type Track = {
  /** "yt:<videoId>" | "it:<itunesId>" | "lr:<lrclibId>" */
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  /** seconds */
  duration?: number;
  /** 30s preview used as last-resort failover */
  previewUrl?: string;
  /** lyric snippet when found through lyric search */
  lyricLine?: string;
};

export type Artist = { id: string; name: string; avatar?: string };
export type Album = { id: string; title: string; artist: string; artwork?: string };

export type SearchResponse = {
  songs: Track[];
  artists: Artist[];
  albums: Album[];
  lyrics: Track[];
  via: string[];
  error?: string;
};

export type LyricLine = { t: number; text: string };
export type LyricsResponse = { synced: LyricLine[]; plain: string };

export type PlayerState = "idle" | "loading" | "playing" | "paused" | "error" | "stopped";
export type RepeatMode = "off" | "all" | "one";
export type ThemeId = "frosted" | "paper" | "neon" | "aurora" | "vinyl";

export type Playlist = { id: number; name: string; count: number; createdAt: string };
