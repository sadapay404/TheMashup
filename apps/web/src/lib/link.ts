/**
 * Link parsing.
 *
 * People paste links. They paste them from the YouTube app's Share sheet, from a browser address bar,
 * from a playlist they were sent, and sometimes with the app's own tracking parameters attached. The
 * job of this module is to turn any of that into a videoId or playlistId — and to say plainly when the
 * link is not something we can play, rather than silently doing nothing.
 *
 * Deliberately pure and dependency-free so it is trivially testable and cannot fail at runtime.
 */

export type ParsedLink =
  | { kind: 'video'; videoId: string }
  | { kind: 'playlist'; playlistId: string; videoId?: string }
  | { kind: 'unsupported'; reason: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{12,}$/;

/**
 * Extract a video id from the many URL shapes YouTube uses.
 *
 * Covered: watch?v=, youtu.be/, /shorts/, /embed/, /live/, music.youtube.com/watch?v=,
 * the `youtu.be/ID?si=…` share format, and a bare 11-character id pasted on its own.
 */
function videoIdFromUrl(url: URL): string | undefined {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && VIDEO_ID.test(id) ? id : undefined;
  }

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;

  // /shorts/ID, /embed/ID, /live/ID, /v/ID
  const m = url.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
  if (m?.[1]) return m[1];

  return undefined;
}

export function parseLink(raw: string): ParsedLink | null {
  const text = raw.trim();
  if (!text) return null;

  // A bare id is a legitimate paste (people do it).
  if (VIDEO_ID.test(text)) return { kind: 'video', videoId: text };

  // Bare playlist id.
  if (text.startsWith('PL') || text.startsWith('OLAK') || text.startsWith('RD')) {
    if (PLAYLIST_ID.test(text)) return { kind: 'playlist', playlistId: text };
  }

  let url: URL;
  try {
    // Accept links pasted without a scheme (`music.youtube.com/watch?v=…`).
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { kind: 'unsupported', reason: 'That does not look like a link.' };
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const known =
    host === 'youtu.be' ||
    host.endsWith('youtube.com') ||
    host.endsWith('youtube-nocookie.com') ||
    host.endsWith('music.youtube.com');

  if (!known) {
    return { kind: 'unsupported', reason: `“${host}” is not a YouTube or YouTube Music link.` };
  }

  const playlistId = url.searchParams.get('list') ?? undefined;
  const videoId = videoIdFromUrl(url);

  if (playlistId && PLAYLIST_ID.test(playlistId)) {
    return videoId ? { kind: 'playlist', playlistId, videoId } : { kind: 'playlist', playlistId };
  }
  if (videoId) return { kind: 'video', videoId };

  if (url.pathname.startsWith('/playlist')) {
    return { kind: 'unsupported', reason: 'That playlist link has no id in it.' };
  }
  if (url.pathname === '/' || url.pathname === '') {
    return { kind: 'unsupported', reason: 'That is a YouTube home page, not a track or playlist.' };
  }
  return { kind: 'unsupported', reason: 'No video or playlist id found in that link.' };
}

/** Human summary for the UI, so the user knows what the paste will do before committing to it. */
export function describeLink(parsed: ParsedLink): string {
  switch (parsed.kind) {
    case 'video':
      return `Track · ${parsed.videoId}`;
    case 'playlist':
      return parsed.videoId ? 'Playlist (opens the track)' : 'Playlist';
    default:
      return parsed.reason;
  }
}
