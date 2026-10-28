export const THEME_IDS = [
  "frosted",
  "paper-ink",
  "neon",
  "aurora",
  "vinyl",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = "frosted";

export const AUDIO_QUALITIES = ["128k", "320k", "best"] as const;
export type AudioQuality = (typeof AUDIO_QUALITIES)[number];

export const VIDEO_QUALITIES = ["360p", "720p", "1080p", "4k"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

export const REPEAT_MODES = ["off", "all", "one"] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

/** Ordered fallback policy: yt-dlp (primary, per user decision) → Piped → Invidious. */
export const RESOLVER_PRIORITY = ["ytdlp", "piped", "invidious"] as const;

/** How long a proxied stream token stays valid in the gateway store. */
export const STREAM_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

/** Rate limits (per IP, per minute) applied by the gateway. */
export const RATE_LIMITS = {
  search: 90,
  streams: 40,
  default: 300,
} as const;
