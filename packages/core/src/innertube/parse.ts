/**
 * Response parsers.
 *
 * THE ZERO-CRASH CONTRACT LIVES HERE.
 * Every accessor is optional-chained, every function returns a value (never throws), and unknown
 * renderer shapes are skipped rather than fatal. Upstream renames a renderer → we lose one row, not
 * the app. Proven by the hostile-input tests in spike/innertube-probe.mjs and the unit suite.
 */

import type {
  Album,
  Artist,
  AudioFormat,
  Playlist,
  SearchResult,
  SearchSection,
  StreamInfo,
  Thumb,
  Track,
  VideoFormat,
} from '../domain.js';
import { PROFILES, type ProfileName } from './profiles.js';

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Extract text from a `musicResponsiveListItemFlexColumnRenderer` wrapper (not the bare text node). */
function flexColText(col: unknown): string {
  const renderer = obj(col)['musicResponsiveListItemFlexColumnRenderer'];
  const text = obj(renderer)['text'];
  const direct = runsText(text);
  return direct || runsText(renderer);
}

/** Concatenate the runs of a text node. */
export function runsText(node: unknown): string {
  const n = obj(node);
  if (Array.isArray(n['runs'])) {
    return n['runs'].map((r) => String(obj(r)['text'] ?? '')).join('');
  }
  if (typeof n['simpleText'] === 'string') return n['simpleText'];
  return '';
}

export function parseDurationSec(text: string): number {
  const parts = text.trim().split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  if (parts.length === 3) return (parts[0] as number) * 3600 + (parts[1] as number) * 60 + (parts[2] as number);
  if (parts.length === 2) return (parts[0] as number) * 60 + (parts[1] as number);
  return 0;
}

export function parseThumbs(node: unknown): Thumb[] {
  const list = arr(obj(obj(node)['thumbnail'])['thumbnails']);
  const out: Thumb[] = [];
  for (const t of list) {
    const o = obj(t);
    const url = typeof o['url'] === 'string' ? o['url'] : undefined;
    if (!url) continue;
    out.push({ url, width: Number(o['width'] ?? 0), height: Number(o['height'] ?? 0) });
  }
  return out;
}

/** Best thumbnail for a target display width (avoids downloading a 544px image for a 44px row). */
export function pickThumb(thumbs: Thumb[], targetPx: number): string | undefined {
  if (!thumbs.length) return undefined;
  const sorted = [...thumbs].sort((a, b) => a.width - b.width);
  const hit = sorted.find((t) => t.width >= targetPx);
  return (hit ?? sorted[sorted.length - 1])?.url;
}

const BULLET = /\s*[•·]\s*/;

function videoIdFromListItem(r: Json): string | undefined {
  const direct = obj(r['playlistItemData'])['videoId'];
  if (typeof direct === 'string') return direct;

  /*
   * `musicTwoRowItemRenderer` — the card row used on the home page — carries its video id on the
   * item's own navigation endpoint rather than in `playlistItemData`. Missing this made every
   * two-row card parse as "not a song", so a shelf built entirely from cards vanished.
   */
  const fromNav = obj(obj(r['navigationEndpoint'])['watchEndpoint'])['videoId'];
  if (typeof fromNav === 'string') return fromNav;

  const play = obj(
    obj(obj(obj(r['overlay'])['musicItemThumbnailOverlayRenderer'])['content'])['musicPlayButtonRenderer'],
  )['playNavigationEndpoint'];
  const id = obj(obj(play)['watchEndpoint'])['videoId'];
  return typeof id === 'string' ? id : undefined;
}

function browseIdFromEndpoint(node: unknown): string | undefined {
  const ep = obj(obj(node)['navigationEndpoint']);
  const b = obj(ep['browseEndpoint'])['browseId'];
  return typeof b === 'string' ? b : undefined;
}

/**
 * `musicResponsiveListItemRenderer` → Track (the workhorse of search results).
 * Accepts either the renderer itself or a shelf item that wraps it, because upstream is
 * inconsistent about which level the renderer sits at between endpoints.
 */
export function parseTrackRow(raw: unknown, source = 'search'): Track | null {
  const outer = obj(raw);
  const wrapped = outer['musicResponsiveListItemRenderer'];
  const r = wrapped ? obj(wrapped) : outer;
  const id = videoIdFromListItem(r);
  if (!id) return null;

  const cols = arr(r['flexColumns']).map((c) => flexColText(c));
  const title = cols[0]?.trim() || '(unknown title)';
  const meta = (cols[1] ?? '').split(BULLET).filter(Boolean);
  const artist = meta[0] ?? '';
  const album = meta[1] && !/^\d+:\d{2}$/.test(meta[1]) ? meta[1] : undefined;
  const durText = meta.find((m) => /^\d+:\d{2}$/.test(m)) ?? '';
  const secondCol = arr(r['flexColumns'])[1];
  const artistId = browseIdFromEndpoint(secondCol);

  const durationText = runsText(obj(arr(r['fixedColumns'])[0])['musicResponsiveListItemFixedColumnRenderer']);
  const firstCol = arr(r['flexColumns'])[0];
  const kindBadge = firstCol ? flexColText(firstCol) : '';

  return {
    id,
    title,
    artist,
    ...(artistId ? { artistId } : {}),
    ...(album ? { album } : {}),
    durationSec: parseDurationSec(durationText || durText),
    thumbs: parseThumbs(obj(r['thumbnail'])['musicThumbnailRenderer']),
    source: kindBadge ? `${source}` : source,
  };
}

export function parseAlbumRow(raw: unknown): Album | null {
  const outer = obj(raw);
  const r = outer['musicResponsiveListItemRenderer'] ? obj(outer['musicResponsiveListItemRenderer']) : outer;
  const id = browseIdFromEndpoint(r);
  if (!id) return null;
  const cols = arr(r['flexColumns']).map((c) => flexColText(c));
  const meta = (cols[1] ?? '').split(BULLET).filter(Boolean);
  return {
    id,
    title: cols[0]?.trim() || '(unknown album)',
    artist: meta[0] ?? '',
    ...(meta[1] && /^\d{4}$/.test(meta[1]) ? { year: Number(meta[1]) } : {}),
    thumbs: parseThumbs(obj(r['thumbnail'])['musicThumbnailRenderer']),
  };
}

export function parseArtistRow(raw: unknown): Artist | null {
  const outer = obj(raw);
  const r = outer['musicResponsiveListItemRenderer'] ? obj(outer['musicResponsiveListItemRenderer']) : outer;
  const id = browseIdFromEndpoint(r);
  if (!id) return null;
  const cols = arr(r['flexColumns']).map((c) => flexColText(c));
  return {
    id,
    name: cols[0]?.trim() || '(unknown artist)',
    thumbs: parseThumbs(obj(r['thumbnail'])['musicThumbnailRenderer']),
    ...(cols[1] ? { subscriberCount: cols[1] } : {}),
  };
}

export function parsePlaylistRow(raw: unknown): Playlist | null {
  const outer = obj(raw);
  const r = outer['musicResponsiveListItemRenderer'] ? obj(outer['musicResponsiveListItemRenderer']) : outer;
  const id = browseIdFromEndpoint(r);
  if (!id) return null;
  const cols = arr(r['flexColumns']).map((c) => flexColText(c));
  return {
    id,
    title: cols[0]?.trim() || '(unknown playlist)',
    ...(cols[1] ? { author: cols[1] } : {}),
    thumbs: parseThumbs(obj(r['thumbnail'])['musicThumbnailRenderer']),
  };
}

function shelfOf(section: unknown): Json | undefined {
  const s = obj(section);
  for (const key of ['musicShelfRenderer', 'musicCarouselShelfRenderer', 'gridRenderer']) {
    if (s[key]) return obj(s[key]);
  }
  return undefined;
}

/** Classify a shelf by the browse ids inside it — resilient to renamed renderers. */
function classifyShelf(contents: unknown[]): SearchSection['kind'] | 'mixed' {
  const first = obj(contents[0]);
  const r = obj(Object.values(first)[0]);
  // Read the *second* flex column (title is the first, metadata is the second).
  const cols = arr(r['flexColumns']).map((c) => flexColText(c));
  const meta = (cols[1] ?? '').toLowerCase();
  if (videoIdFromListItem(r)) return 'songs';
  if (meta.includes('album') || meta.includes('single') || meta.includes('ep')) return 'albums';
  if (meta.includes('artist')) return 'artists';
  if (meta.includes('playlist')) return 'playlists';
  return 'mixed';
}

/**
 * Parse a `/search` response into typed sections.
 * Unknown sections are skipped; a malformed payload yields `{ sections: [] }`, never a throw.
 */
export function parseSearch(json: unknown): SearchResult {
  const root = obj(json);
  const tabs = arr(obj(obj(root['contents'])['tabbedSearchResultsRenderer'])['tabs']);
  const firstTab = obj(tabs[0]);
  const tabContent = obj(firstTab['tabRenderer'])['content'];
  const contents = arr(obj(obj(tabContent)['sectionListRenderer'])['contents']);

  const sections: SearchSection[] = [];
  let continuation: string | undefined;

  for (const section of arr(contents)) {
    // Top result card
    const card = obj(obj(section)['musicCardShelfRenderer']);
    if (Object.keys(card).length) {
      const track = parseTrackRow(obj(card['title']) && card['title'] ? trackFromCard(card) : undefined);
      if (track) sections.push({ kind: 'top', track });
      continue;
    }

    const shelf = shelfOf(section);
    if (!shelf) continue;

    const items = arr(shelf['contents']);
    if (!continuation) {
      const cont = obj(arr(shelf['continuations'])[0])['nextContinuationData'];
      const token = obj(cont)['continuation'];
      if (typeof token === 'string') continuation = token;
    }

    const kind = classifyShelf(items);
    if (kind === 'songs') {
      const tracks = items.map((i) => parseTrackRow(i)).filter((t): t is Track => t !== null);
      if (tracks.length) sections.push({ kind: 'songs', items: tracks });
    } else if (kind === 'albums') {
      const albums = items.map(parseAlbumRow).filter((a): a is Album => a !== null);
      if (albums.length) sections.push({ kind: 'albums', items: albums });
    } else if (kind === 'artists') {
      const artists = items.map(parseArtistRow).filter((a): a is Artist => a !== null);
      if (artists.length) sections.push({ kind: 'artists', items: artists });
    } else if (kind === 'playlists') {
      const playlists = items.map(parsePlaylistRow).filter((p): p is Playlist => p !== null);
      if (playlists.length) sections.push({ kind: 'playlists', items: playlists });
    } else {
      // Mixed shelf: keep every row that yields a track so nothing is silently lost.
      const tracks = items.map((i) => parseTrackRow(i)).filter((t): t is Track => t !== null);
      if (tracks.length) sections.push({ kind: 'songs', items: tracks });
    }
  }

  return { sections, ...(continuation ? { continuation } : {}) };
}

function trackFromCard(card: Json): unknown {
  const title = runsText(card['title']);
  const subtitle = runsText(card['subtitle']);
  const nav = obj(obj(obj(card['onTap'])['watchEndpoint'])['videoId']);
  const videoId =
    (typeof nav === 'string' ? nav : undefined) ??
    (typeof obj(obj(card['onDoubleTap'])['watchEndpoint'])['videoId'] === 'string'
      ? (obj(obj(card['onDoubleTap'])['watchEndpoint'])['videoId'] as string)
      : undefined);
  if (!videoId) return undefined;
  const meta = subtitle.split(BULLET).filter(Boolean);
  return {
    playlistItemData: { videoId },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: meta.join(' • ') }] } } },
    ],
    thumbnail: card['thumbnail'],
  };
}

/** `next` → radio queue. Returns tracks only; empty array on any malformed input. */
export function parseRadioQueue(json: unknown): Track[] {
  const root = obj(json);
  const watchNext = obj(obj(root['contents'])['singleColumnMusicWatchNextResultsRenderer']);
  const tabs = arr(obj(obj(watchNext['tabbedRenderer'])['watchNextTabbedResultsRenderer'])['tabs']);

  // Find the queue tab: the one whose content carries a musicQueueRenderer.
  let panel: unknown;
  for (const tab of tabs) {
    const content = obj(obj(tab)['tabRenderer'])['content'];
    const queue = obj(content)['musicQueueRenderer'];
    if (queue) {
      panel = obj(obj(queue)['content'])['playlistPanelRenderer'];
      break;
    }
  }

  const out: Track[] = [];
  for (const item of arr(obj(panel)['contents'])) {
    const r = obj(obj(item)['playlistPanelVideoRenderer']);
    const id = r['videoId'];
    if (typeof id !== 'string') continue;
    out.push({
      id,
      title: runsText(r['title']) || '(unknown title)',
      artist: runsText(r['longBylineText']) || runsText(r['shortBylineText']),
      durationSec: parseDurationSec(runsText(r['lengthText'])),
      thumbs: parseThumbs(r['thumbnail']),
      source: 'radio',
    });
  }
  return out;
}

/** Lyrics browse id, when `next` exposes one (`MPLYt…`). */
export function parseLyricsBrowseId(json: unknown): string | undefined {
  const text = JSON.stringify(json ?? {});
  const m = text.match(/"lyrics"\s*:\s*"(MPLYt[^"]+)"/);
  return m?.[1];
}

const AUDIO_ITAGS: Readonly<Record<number, { codec: string; kbps: number; premium?: boolean }>> = {
  139: { codec: 'AAC HE v1', kbps: 48 },
  140: { codec: 'AAC LC', kbps: 128 },
  141: { codec: 'AAC LC', kbps: 256, premium: true },
  249: { codec: 'Opus', kbps: 50 },
  250: { codec: 'Opus', kbps: 70 },
  251: { codec: 'Opus', kbps: 160 },
  256: { codec: 'AAC HE v1', kbps: 192 },
  258: { codec: 'AAC LC', kbps: 384 },
};

/**
 * `player` → typed format ladder + any directly usable URLs.
 * Formats whose URL is ciphered are reported (`deliver: 'cipher'`) rather than dropped, so the UI
 * can honestly say "needs signature" instead of silently hiding a quality tier.
 */
/**
 * Read a track from a player response's `videoDetails`.
 *
 * Used for the "paste a link" path: the id is already known, so this is the cheapest way to get the
 * real title, artist, duration and artwork without a second search round-trip.
 */
export function parseVideoDetails(json: unknown, videoId: string): Track | null {
  const root = obj(json);
  const details = obj(root['videoDetails']);
  const title = String(details['title'] ?? '').trim();
  if (!title) return null;

  const lengthSec = Number(details['lengthSeconds'] ?? 0);
  const author = String(details['author'] ?? '').trim();
  const thumbs = arr(obj(details)['thumbnail'] ? obj(obj(details)['thumbnail'])['thumbnails'] : []);
  const parsed: Thumb[] = thumbs
    .map((t) => {
      const o = obj(t);
      const url = String(o['url'] ?? '');
      return { url, width: Number(o['width'] ?? 0), height: Number(o['height'] ?? 0) };
    })
    .filter((t) => t.url);

  return {
    id: videoId,
    title,
    artist: author,
    ...(String(details['channelId'] ?? '') ? { artistId: String(details['channelId']) } : {}),
    durationSec: Number.isFinite(lengthSec) ? lengthSec : 0,
    thumbs: parsed.length ? parsed : [`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`].map((url) => ({
      url,
      width: 480,
      height: 360,
    })),
    source: 'link',
  };
}

export function parsePlayer(json: unknown, profile: string, videoId: string): StreamInfo {
  const root = obj(json);
  const streaming = obj(root['streamingData']);
  const adaptive = arr(streaming['adaptiveFormats']);
  const progressive = arr(streaming['formats']);
  const playability = String(obj(root['playabilityStatus'])['status'] ?? 'UNKNOWN');

  const audio: AudioFormat[] = [];
  const video: VideoFormat[] = [];
  const urls: Record<number, string> = {};

  for (const raw of [...adaptive, ...progressive]) {
    const f = obj(raw);
    const itag = Number(f['itag']);
    if (!Number.isFinite(itag)) continue;
    const mime = String(f['mimeType'] ?? '');
    const direct = typeof f['url'] === 'string' ? f['url'] : undefined;
    const cipher = typeof f['signatureCipher'] === 'string' || typeof f['cipher'] === 'string';
    const deliver: AudioFormat['deliver'] = direct ? 'url' : cipher ? 'cipher' : 'none';
    if (direct) urls[itag] = direct;

    if (mime.startsWith('audio/')) {
      const meta = AUDIO_ITAGS[itag];
      const codecFromMime = mime.match(/codecs="([^"]+)"/)?.[1] ?? 'unknown';
      audio.push({
        itag,
        codec: meta?.codec ?? codecFromMime,
        nominalKbps: meta?.kbps ?? Math.round(Number(f['bitrate'] ?? 0) / 1000),
        actualKbps: Math.round(Number(f['bitrate'] ?? 0) / 1000),
        container: mime.includes('webm') ? 'webm' : 'm4a',
        quality: String(f['audioQuality'] ?? '').replace('AUDIO_QUALITY_', '') || 'UNKNOWN',
        deliver,
        premiumOnly: meta?.premium === true,
        durationSec: Number(f['approxDurationMs'] ?? 0) / 1000,
      });
    } else if (mime.startsWith('video/')) {
      const height = Number(f['height'] ?? 0);
      video.push({
        itag,
        height,
        res: height ? `${height}p` : '?',
        codec: (mime.match(/codecs="([^"]+)"/)?.[1] ?? 'unknown').split(',')[0] ?? 'unknown',
        fps: Number(f['fps'] ?? 30),
        kbps: Math.round(Number(f['bitrate'] ?? 0) / 1000),
        container: mime.includes('webm') ? 'webm' : 'mp4',
        hasAudio: mime.includes('mp4a') || mime.includes('opus'),
        deliver,
      });
    }
  }

  audio.sort((a, b) => b.nominalKbps - a.nominalKbps);
  const byRes = new Map<string, VideoFormat>();
  for (const v of [...video].sort((a, b) => b.height - a.height || b.kbps - a.kbps)) {
    const existing = byRes.get(v.res);
    if (!existing) byRes.set(v.res, v);
  }

  return {
    videoId,
    profile,
    audio,
    video: [...byRes.values()],
    expiresInSec: Number(streaming['expiresInSeconds'] ?? 0),
    playability,
    urls,
  };
}

/** Best playable audio URL for streaming, preferring the best free tier. */
/**
 * Choose a stream, preferring one that will actually play to the end.
 *
 * Three separate traps, in the order they cost the listener:
 *
 *  1. **Ciphered formats.** `signatureCipher` entries need YouTube's player JavaScript to turn into
 *     a URL. We have no JS interpreter, so such a format is not a stream — only a direct `url` is.
 *     Accepting one looks like success and plays nothing.
 *
 *  2. **PoToken-gated formats.** These yield a working URL that serves roughly the first megabyte
 *     and then answers 403. At 256 kbps that is ~30 seconds, which is indistinguishable from a
 *     preview clip or a stall. They are the last resort, never the first choice.
 *
 *  3. **Preview clips.** Some responses genuinely carry a ~30s sample. `expectedSec` (the track's own
 *     runtime) exposes them: a format declaring a small fraction of the track is a clip.
 *
 * Bitrate is then treated differently depending on who produced the stream. From a token-free
 * client we take the best quality available — there is nothing to economise against. From a
 * token-gated client we deliberately take the *cheapest* stream, because if the server caps us at
 * one megabyte, that budget is measured in bytes, not seconds: 160 kbps buys nearly twice the
 * playback of 256 for a difference no phone speaker reveals.
 */
export function pickAudioUrl(
  info: StreamInfo,
  expectedSec = 0,
): { itag: number; url: string; preview: boolean } | undefined {
  const isPreview = (f: AudioFormat): boolean =>
    Boolean(expectedSec) && f.durationSec > 0 && f.durationSec < expectedSec * 0.6;

  // Only formats we can actually turn into a URL. `deliver: 'cipher'` is not playable here.
  const playable = info.audio.filter((f) => info.urls[f.itag]);
  if (!playable.length) return undefined;

  const free = playable.filter((f) => !f.premiumOnly);
  const pool = free.length ? free : playable;

  /*
   * Does the client that produced this response require a stream PoToken? If so the server may cut us
   * off after roughly a megabyte, and the cheapest stream is the one that plays longest.
   *
   * An unknown profile is *not* assumed gated when it is a native one. `native:*` comes from the
   * on-device extractor, which only offers clients it can serve in full; treating it as gated made the
   * picker prefer the lowest bitrate for the one resolver that can actually deliver quality. The
   * fallback of `true` still applies to any genuinely unrecognised InnerTube profile, because for those
   * the cautious assumption is the right one.
   */
  const profile = PROFILES[info.profile as ProfileName];
  const gated = profile ? profile.needsStreamPoToken : !info.profile.startsWith('native:');

  const byAffinity = (a: AudioFormat, b: AudioFormat) => {
    // Full-length before preview, always: a cheap clip is still a clip.
    const pa = isPreview(a) ? 1 : 0;
    const pb = isPreview(b) ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return gated ? a.nominalKbps - b.nominalKbps : b.nominalKbps - a.nominalKbps;
  };

  const best = [...pool].sort(byAffinity)[0];
  if (!best) return undefined;
  return { itag: best.itag, url: info.urls[best.itag]!, preview: isPreview(best) };
}

/**
 * Walk the client ladder and report what each rung actually offered.
 *
 * Exists because "the song stops after thirty seconds" and "this client returns ciphered formats" are
 * the same fact seen from two ends, and neither was observable before. Returns the first rung that
 * yields a stream we can point a player at, plus a line per rung so the caller can log or display the
 * whole picture.
 */
export interface RungReport {
  profile: ProfileName;
  /** Formats the response listed. */
  formats: number;
  /** Formats that could become a URL (a direct `url`, not `signatureCipher`). */
  direct: number;
  /** Direct formats withheld because they need a stream PoToken. */
  gated: number;
  playable: boolean;
}

export function inspectRungs(json: unknown, profile: ProfileName, videoId: string): RungReport {
  const info = parsePlayer(json, profile, videoId);
  const needsToken = PROFILES[profile]?.needsStreamPoToken ?? true;
  const direct = info.audio.filter((f) => info.urls[f.itag]).length;
  return {
    profile,
    formats: info.audio.length,
    direct,
    gated: needsToken ? direct : 0,
    playable: Boolean(pickAudioUrl(info)),
  };
}

/*
 * ---------------------------------------------------------------------------
 * The home feed
 * ---------------------------------------------------------------------------
 *
 * YT Music's home page is a `browse` call on `FEmusic_home`, and unlike a search it is **personal**:
 * the shelves it returns depend on the signed-in account's watch and listen history. That is the
 * whole reason this exists. The previous Home screen invented recommendations by seeding radios from
 * the local play history, which cannot know the difference between "Urdu songs I happen to play" and
 * "the Urdu genre I am actually in the mood for" — the user's exact complaint. YouTube already knows;
 * the only correct move is to ask it.
 *
 * The renderer names below are the ones that matter in practice:
 *  - `musicCarouselShelfRenderer` — the horizontal rows ("Listen again", "Mixed for you").
 *  - `musicShelfRenderer`         — a vertical list at the top of the page.
 *  - `musicCardShelfRenderer`     — the large "your mix" style card.
 * Shelf *titles* are whatever YouTube decided to call them today, which is why the contract here is
 * `{ title, tracks }` and not a fixed enum: the app can render any shelf name it is handed. Rows with
 * a browse endpoint and no video id are dropped rather than guessed at.
 */

/** A named row on the home page. `title` is YouTube's own label, passed through verbatim. */
export interface FeedShelf {
  title: string;
  tracks: Track[];
}

/** Which named shelves the app asks for by default, in the order it wants them shown. */
export const FEED_SHELF_ORDER = [
  'Quick picks',
  'Mixed for you',
  'Listen again',
  'Replay',
  'Your favourites',
] as const;

/** Flatten `runs` or `simpleText` into a string. Both shapes occur in the same response. */
function textOf(v: unknown): string {
  const o = obj(v);
  if (typeof o['simpleText'] === 'string') return o['simpleText'] as string;
  return arr(o['runs'])
    .map((r) => (typeof obj(r)['text'] === 'string' ? (obj(r)['text'] as string) : ''))
    .join('');
}

/** The title of a shelf renderer, wherever that renderer happens to keep it. */
function shelfTitle(shelf: Json): string {
  for (const key of ['title', 'header']) {
    const node = obj(shelf[key]);
    if (Object.keys(node).length) {
      // `header` wraps its own renderer one level down.
      const inner = obj(node['musicCarouselShelfBasicHeaderRenderer']);
      if (Object.keys(inner).length) {
        const t = textOf(inner['title']);
        if (t) return t;
      }
      const t = textOf(node['title']) || textOf(node);
      if (t) return t;
    }
  }
  return '';
}

/**
 * Pull tracks out of one shelf, tolerating every content renderer YT Music uses for rows.
 *
 * `musicResponsiveListItemRenderer` covers both the carousel rows and the vertical shelves;
 * `musicTwoRowItemRenderer` is the card-style row that only appears on the home page. Both are tried,
 * and anything that yields no video id is skipped — a "shelf" full of playlist links is not a list of
 * songs you can play from here.
 */
function tracksFromShelf(shelf: Json): Track[] {
  const out: Track[] = [];
  for (const item of arr(shelf['contents'])) {
    const wrapper = obj(item);
    // Two-row items sit inside their own wrapper; responsive rows are passed straight through.
    const twoRow = obj(wrapper['musicTwoRowItemRenderer']);
    if (Object.keys(twoRow).length) {
      const card = parseTwoRowItem(twoRow);
      if (card) out.push(card);
      continue;
    }
    const responsive = obj(wrapper['musicResponsiveListItemRenderer']);
    if (!Object.keys(responsive).length) continue;
    const track = parseTrackRow(responsive, 'home');
    if (track) out.push(track);
  }
  return out;
}

/**
 * `musicTwoRowItemRenderer` → Track.
 *
 * The card-shaped row that only appears on the home page. It carries `title` and `subtitle` as text
 * run objects rather than the `flexColumns` the responsive row uses, so `parseTrackRow` — which reads
 * columns — returns null for it. Hence a separate reader.
 *
 * A two-row item with **no video id** is a playlist, album or artist card, not a song: those are
 * deliberately dropped here, because a shelf of unplayable cards would fill Home with rows that do
 * nothing when tapped. The alternative — guessing the first song of a playlist — would make the queue
 * disagree with what the user tapped.
 */
function parseTwoRowItem(r: Json): Track | null {
  const id = videoIdFromListItem(r);
  if (!id) return null;
  const title = textOf(r['title']).trim();
  if (!title) return null;
  const subtitle = textOf(r['subtitle']);
  const parts = subtitle.split(BULLET).map((x) => x.trim()).filter(Boolean);
  const durText = parts.find((p) => /^\d+:\d{2}$/.test(p)) ?? '';
  const artist = parts.find((p) => p && !/^\d+:\d{2}$/.test(p)) ?? '';
  return {
    id,
    title,
    artist,
    durationSec: parseDurationSec(durText),
    thumbs: parseThumbs(obj(r['thumbnail'])['musicThumbnailRenderer']),
    source: 'home',
  };
}

/**
 * Parse `browse(FEmusic_home)` into named shelves.
 *
 * Returns `{ shelves: [] }` on anything unexpected — same zero-crash contract as the rest of this
 * file. The caller decides whether an empty feed means "signed out" or "YouTube changed the page".
 */
export function parseHomeFeed(json: unknown): { shelves: FeedShelf[] } {
  const shelves: FeedShelf[] = [];
  const root = obj(json);

  // The home page arrives under `contents.singleColumnBrowseResultsRenderer.tabs[0]...`.
  const tabs = arr(obj(obj(obj(root['contents'])['singleColumnBrowseResultsRenderer'])['tabs']));
  const sectionList = obj(obj(obj(obj(tabs[0])['tabRenderer'])['content'])['sectionListRenderer']);

  const visit = (sections: unknown[]) => {
    for (const section of sections) {
      const s = obj(section);
      /*
       * A shelf can be nested one level deeper (`musicShelfRenderer` inside a
       * `musicShelfRenderer`), so recurse through any contents array that is not itself a row list.
       * Bounded by the response shape, not by a counter — this is not user input.
       */
      const carousel = obj(s['musicCarouselShelfRenderer']);
      if (Object.keys(carousel).length) {
        const tracks = tracksFromShelf(carousel);
        if (tracks.length) {
          const title = shelfTitle(carousel);
          if (title) shelves.push({ title, tracks });
        }
        continue;
      }

      const shelf = obj(s['musicShelfRenderer']);
      if (Object.keys(shelf).length) {
        const tracks = tracksFromShelf(shelf);
        if (tracks.length) {
          const title = shelfTitle(shelf);
          if (title) shelves.push({ title, tracks });
        }
        continue;
      }

      // A section that only wraps more sections.
      const inner = arr(obj(s['itemSectionRenderer'])['contents']);
      if (inner.length) visit(inner);
    }
  };

  visit(arr(sectionList['contents']));
  return { shelves };
}
