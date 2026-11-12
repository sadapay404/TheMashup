/**
 * The app's single entry point to the engine.
 *
 * Routing strategy (this is the heart of "serverless in a browser"):
 *   BROWSER  → PublicApiProvider (Piped/Invidious, CORS-enabled by design) for search + streams.
 *              Falls back to InnerTube via the relay ladder only if every instance fails.
 *   NATIVE   → InnerTube directly (rich music payload, no CORS), provider as a fallback rung.
 *
 * Every method returns a Result or a plain value. Nothing here throws at a component boundary.
 */

import {
  InnerTube,
  LyricIndex,
  PROFILES,
  PublicApiProvider,
  parseVideoDetails,
  STREAM_LADDER,
  TransportChain,
  err,
  getLyrics,
  ok,
  parsePlayer,
  parseRadioQueue,
  parseSearch,
  pickAudioUrl,
  type AudioFormat,
  type Lyrics,
  type LyricDoc,
  type ProfileName,
  type SearchFilter,
  type SearchResult,
  type StreamInfo,
  type Track,
  type VideoFormat,
  type AppError,
} from '@themashup/core';

import { isDesktop, nativeHttp } from './desktop';
import {
  nativeBootMark,
  nativeExtractorStatus,
  nativeResolveStream,
  type NativeResolvedStream,
} from './native';

/**
 * One line into the on-device diagnostics file.
 *
 * Resolution failures used to be invisible: the app would go quiet and there was nothing on the
 * phone to read afterwards. Every routing decision that matters writes a line here, so a report
 * carries the answer instead of a guess. Never throws, never blocks, and is a no-op in a browser.
 */
function diag(message: string): void {
  try {
    nativeBootMark(message);
  } catch {
    /* diagnostics must never break playback */
  }
}
import type { RawResponse } from '@themashup/core';

const LS_VISITOR = 'mashup.visitorData';
const LS_COOKIE = 'mashup.cookie';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — non-fatal */
  }
}

/**
 * Is this a visitor id YouTube actually issued, or bytes we invented?
 *
 * Real `visitorData` is a base64url-encoded protobuf whose first field is a string, so it opens with
 * the tag byte 0x0A and a length — base64 `Cg…` — and is longer than the 11-byte id alone.
 *
 * This check exists because of a real bug: the app used to mint 11 random bytes and send them as
 * `X-Goog-Visitor-Id` on every request. YouTube's protobuf parser rejects that, answering 400 or
 * `UNPLAYABLE`, and 400s were also tripping the transport breaker. Inventing an identity is worse
 * than having none: with no visitor id, YouTube issues one on the first response and we adopt it.
 */
export function isValidVisitorData(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  // Values come back URL-encoded from the wire (`…%3D%3D` for the base64 `==` padding), and a raw
  // `=` would fail the character class below. Decode before judging the shape.
  let value = candidate.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* a stray '%' is already proof this is not a valid token */
    return false;
  }
  if (value.length < 18) return false;
  // `[t-zA-Z…]` looks like "the letter t then a-z" but is a literal range, so the ranges here
  // are written out explicitly.
  return /^Cg[A-Za-z0-9_\-+/]+=*$/.test(value);
}

/** Capacitor/Tauri expose a native bridge; detect it so we can prefer InnerTube there. */
function isNativeShell(): boolean {
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  // Three signals because they arrive at different times: Capacitor's flag, Tauri's convenience
  // global (only when `withGlobalTauri` is on) and Tauri's always-present internals object.
  return Boolean(w.Capacitor?.isNativePlatform?.() || w.__TAURI__ || w.__TAURI_INTERNALS__);
}

/**
 * The desktop transport. Registered with the chain so it is tried *before* any relay: Rust has no
 * origin, so InnerTube accepts the request directly and the third-party dependency disappears.
 *
 * Errors are thrown (not swallowed) so the chain can demote this route and fall through — that is
 * what keeps a broken shell from bricking search.
 */
async function desktopFetch(req: { url: string; method: string; headers: Record<string, string>; body: unknown }): Promise<RawResponse> {
  const result = await nativeHttp({
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: JSON.stringify(req.body),
  });
  if (!result) throw new Error('desktop bridge unavailable');
  if (!result.ok) throw new Error(result.error ?? 'native http failed');

  let json: unknown = null;
  try {
    json = JSON.parse(result.body);
  } catch {
    // A non-JSON body (an HTML error page, a captive portal) is an upstream fault, not a crash:
    // the parser downstream treats null as "nothing usable" and the chain can move on.
    json = null;
  }
  return { status: result.status, json };
}

export class MusicService {
  readonly transport: TransportChain;
  readonly innertube: InnerTube;
  readonly provider: PublicApiProvider;
  readonly lyricIndex: LyricIndex;
  readonly native: boolean;

  visitorData: string;
  cookie: string | null;
  /** Human-readable description of what actually served the last request. */
  lastRoute = 'unknown';
  /** Which InnerTube profile finally produced a stream, and what YouTube said about it. */
  lastProfile = '';
  lastPlayability = '';

  constructor() {
    // Native first whenever the shell provides it; otherwise the ladder is unchanged.
    this.transport = new TransportChain(undefined, false, isDesktop() ? desktopFetch : undefined);
    this.provider = new PublicApiProvider();
    this.native = isNativeShell();

    // Only ever send a visitor id YouTube gave us. An empty string means "none", and the first
    // response will hand us a real one to adopt.
    const stored = readLocal(LS_VISITOR);
    if (!isValidVisitorData(stored)) {
      try {
        localStorage.removeItem(LS_VISITOR);
      } catch {
        /* private mode — non-fatal */
      }
    }
    this.visitorData = isValidVisitorData(stored) ? stored! : '';
    this.cookie = readLocal(LS_COOKIE);

    const lang = typeof navigator !== 'undefined' ? navigator.language : 'en';
    this.innertube = new InnerTube(
      {
        hl: lang.split('-')[0] ?? 'en',
        gl: (lang.split('-')[1] ?? 'US').toUpperCase(),
        visitorData: this.visitorData || undefined,
        cookie: this.cookie ?? undefined,
      },
      this.transport.fetch,
    );
    this.lyricIndex = new LyricIndex();
  }

  /**
   * Take the visitor id YouTube issued in a response, if we do not already have one.
   *
   * YouTube returns `responseContext.visitorData` on the first call from an unidentified client. It
   * is the identity every later request should carry — sending none is a fresh anonymous session on
   * every call, which is part of why playability answers were inconsistent.
   */
  adoptVisitorData(json: unknown): void {
    if (this.visitorData) return;
    const ctx = (json as { responseContext?: { visitorData?: unknown } } | null)?.responseContext;
    const issued = typeof ctx?.visitorData === 'string' ? ctx.visitorData : '';
    if (!isValidVisitorData(issued)) return;
    this.visitorData = issued;
    writeLocal(LS_VISITOR, issued);
    diag(`visitor: adopted server-issued id (${issued.slice(0, 8)}…)`);
  }

  setCookie(cookie: string | null): void {
    this.cookie = cookie && cookie.trim() ? cookie.trim() : null;
    if (this.cookie) writeLocal(LS_COOKIE, this.cookie);
    else {
      try {
        localStorage.removeItem(LS_COOKIE);
      } catch {
        /* ignore */
      }
    }
  }

  hasAccount(): boolean {
    return Boolean(this.cookie);
  }

  /** Search. Never returns an error for "no network" — returns an empty result plus a route note. */
  async search(query: string, filter: SearchFilter = 'all'): Promise<{ ok: boolean; result: SearchResult; route: string; error?: AppError }> {
    // 1. Provider first in the browser (CORS-safe), InnerTube first on native.
    const order: Array<'provider' | 'innertube'> = this.native ? ['innertube', 'provider'] : ['provider', 'innertube'];

    for (const step of order) {
      if (step === 'provider') {
        const result = await this.provider.search(query);
        if (result.sections.length) {
          this.lastRoute = `public API · ${this.provider.lastUsed ?? 'unknown'}`;
          return { ok: true, result, route: this.lastRoute };
        }
      } else {
        try {
          const res = await this.innertube.search(query, filter);
          const parsed = parseSearch(res.json);
          if (parsed.sections.length) {
            this.lastRoute = 'InnerTube direct';
            return { ok: true, result: parsed, route: this.lastRoute };
          }
        } catch {
          /* fall through to the next strategy */
        }
      }
    }

    return {
      ok: false,
      result: { sections: [] },
      route: 'none',
      error: {
        k: 'Network',
        retryable: true,
        cause: 'unknown',
        // Naming the likely cause is more useful than "it did not work": browser mode depends on
        // community-run Piped/Invidious hosts, which many mobile networks and regions block.
        message:
          'No search route answered. The public mirrors this works through are often blocked on mobile networks — try Wi-Fi, or run Diagnostics in Settings to see exactly which routes are reachable from here.',
      },
    };
  }

  async suggestions(input: string): Promise<string[]> {
    if (input.trim().length < 2) return [];
    try {
      const res = await this.innertube.suggestions(input);
      const root = res.json as { contents?: Array<{ searchSuggestionsSectionRenderer?: { contents?: unknown[] } }> };
      const out: string[] = [];
      for (const section of root?.contents ?? []) {
        for (const item of section?.searchSuggestionsSectionRenderer?.contents ?? []) {
          const runs = (item as { searchSuggestionRenderer?: { suggestion?: { runs?: Array<{ text?: string }> } } })
            .searchSuggestionRenderer?.suggestion?.runs;
          const text = runs?.map((r) => r.text ?? '').join('');
          if (text) out.push(text);
        }
      }
      return out.slice(0, 8);
    } catch {
      return [];
    }
  }

  /**
   * Every track in a playlist, in order.
   *
   * Reused by both "paste a playlist link" and "download this whole playlist", so the two never
   * disagree about what the playlist contains.
   */
  async playlistTracks(playlistId: string): Promise<Track[]> {
    try {
      const res = await this.innertube.browse(playlistId);
      const tracks = parseRadioQueue(res.json);
      if (tracks.length) {
        this.lastRoute = 'InnerTube · playlist';
        return tracks;
      }
    } catch {
      /* fall through */
    }
    return [];
  }

  /** Radio for a track: InnerTube `next` when reachable, otherwise related-by-artist from search. */
  async radio(track: Track): Promise<Track[]> {
    try {
      const res = await this.innertube.next(track.id);
      const queue = parseRadioQueue(res.json);
      if (queue.length) return queue;
    } catch {
      /* fall through */
    }
    try {
      const fallback = await this.provider.search(`${track.artist} ${track.title}`);
      if (fallback.sections[0]?.kind === 'songs') {
        return fallback.sections[0].items.filter((t) => t.id !== track.id).slice(0, 25);
      }
    } catch {
      /* nothing available */
    }
    return [];
  }

  /**
   * Resolve a stream, in the order that actually produces playable audio.
   *
   * The order is not arbitrary — it is the whole fix for "the song stops after thirty seconds":
   *
   *  1. **Native extractor** (GPL APK only). The only rung that can mint stream PoTokens, and the only
   *     one whose client table is maintained by someone who tests against YouTube daily. It is first
   *     because it is the only path that returns *whole files*.
   *  2. **InnerTube client profiles.** Cheap, no dependency, and works when a client happens to be
   *     token-free today. Every rung here that needs a PoToken returns a URL that serves ~1 MB and
   *     then 403s, so a "success" from these clients is not evidence of playable audio — see
   *     [pickAudioUrl] and `PROFILES[...].needsStreamPoToken`.
   *  3. **Public Piped/Invidious mirrors.** Third-party and frequently blocked on mobile networks,
   *     but they hand back full files when they work.
   *
   * Before this order existed the native extractor was never asked at all: the Kotlin seam existed,
   * but no bridge method called it, so the enhanced APK carried a working resolver nothing used and
   * the standard APK fell straight through to clients that cannot serve a full track.
   */
  async resolveStream(videoId: string): Promise<{ ok: true; info: StreamInfo } | { ok: false; error: AppError }> {
    // 1. Native extractor, when this APK has one. Reports *why* when it does not.
    if (this.native) {
      let reason = '';
      const nativeStream = await nativeResolveStream(videoId, 0, (why) => {
        reason = why;
      });
      if (nativeStream) {
        this.lastRoute = `native extractor · ${nativeStream.source}`;
        this.lastProfile = nativeStream.source;
        this.lastPlayability = 'OK';
        diag(
          `resolve ${videoId}: native WON — ${nativeStream.kind} itag=${nativeStream.itag} ` +
            `kbps=${nativeStream.kbps} codec=${nativeStream.codec} dur=${nativeStream.durationSec}s`,
        );
        return { ok: true, info: streamInfoFromNative(videoId, nativeStream) };
      }
      // Logged, not swallowed: "the extractor ran and failed" and "there is no extractor" are
      // different problems and used to look identical from the outside.
      const status = await nativeExtractorStatus();
      diag(
        `resolve ${videoId}: native unusable — installed=${status.installed} ` +
          `flavour=${status.flavour} reason=${reason || 'no result'}`,
      );
    }

    // Browser builds resolve through the CORS-friendly provider first; there is no InnerTube there
    // without a relay, so this is not an ordering preference but the only route that works.
    if (!this.native) {
      const fromProvider = await this.provider.stream(videoId);
      if (fromProvider) {
        this.lastRoute = `public API · ${this.provider.lastUsed ?? 'unknown'}`;
        return { ok: true, info: fromProvider };
      }
    }

    const tried: string[] = [];
    for (const profile of STREAM_LADDER as readonly ProfileName[]) {
      tried.push(profile);
      try {
        const res = await this.innertube.player(profile, videoId);
        this.adoptVisitorData(res.json);
        const info = parsePlayer(res.json, profile, videoId);
        if (pickAudioUrl(info)) {
          this.lastRoute = `InnerTube · ${profile}`;
          this.lastProfile = profile;
          this.lastPlayability = info.playability;
          diag(
            `resolve ${videoId}: ${profile} WON — playability=${info.playability} ` +
              `formats=${info.audio.length} direct=${info.audio.filter((f) => info.urls[f.itag]).length}`,
          );
          return { ok: true, info };
        }
        const direct = info.audio.filter((f) => info.urls[f.itag]).length;
        diag(
          `resolve ${videoId}: ${profile} unusable — playability=${info.playability} ` +
            `formats=${info.audio.length} direct=${direct} gated=${PROFILES[profile].needsStreamPoToken}`,
        );
        if (info.audio.length && profile === STREAM_LADDER[STREAM_LADDER.length - 1]) {
          return { ok: true, info };
        }
      } catch (e) {
        const err = e as { k?: string; status?: number; cause?: string; missing?: string; message?: string };
        diag(
          `resolve ${videoId}: ${profile} FAILED — k=${err.k ?? '?'} status=${err.status ?? '-'} ` +
            `cause=${err.cause ?? err.missing ?? '-'} route=${this.transport.health.lastRoute ?? 'none'} ` +
            `msg=${err.message ?? 'no message'}`,
        );
        continue;
      }
    }

    if (this.native) {
      const fromProvider = await this.provider.stream(videoId);
      if (fromProvider) {
        this.lastRoute = `public API · ${this.provider.lastUsed ?? 'unknown'}`;
        return { ok: true, info: fromProvider };
      }
    }

    /*
     * Nothing worked. Say what was tried and what would change the outcome.
     *
     * The old sentence — "No playable source (tried VISIONOS, ANDROID_VR, …)" — named internal client
     * ids at a listener, which is an explanation for the person who wrote the ladder, not for the
     * person holding the phone. It also did not mention the one fact that matters: this build cannot
     * make the token YouTube now demands.
     */
    const extractor = this.native ? await nativeExtractorStatus() : null;
    const advice = extractor && !extractor.installed
      ? ' This app build has no native extractor, and YouTube currently gates every client that could ' +
        'play a full track. Install the GPL build (app-withNativeExtractor-release.apk) to resolve streams properly.'
      : '';
    return {
      ok: false,
      error: {
        k: 'Network',
        retryable: true,
        cause: 'unknown',
        message:
          `Could not get a playable stream for this track — tried ${tried.join(', ')} and the public mirrors.${advice}`,
      },
    };
  }

  /**
   * Turn a pasted video id into a real Track.
   *
   * Title, artist, duration and artwork come from the player response, so this costs one request
   * rather than a search round-trip. Returns null when the id is unplayable — the caller reports that
   * honestly instead of queueing a blank row.
   */
  async trackFromId(videoId: string): Promise<Track | null> {
    // Try the richest profiles first; the same ladder the stream resolver uses.
    for (const profile of STREAM_LADDER as readonly ProfileName[]) {
      try {
        const res = await this.innertube.player(profile, videoId);
        const track = parseVideoDetails(res.json, videoId);
        if (track) {
          this.lastRoute = `InnerTube · ${profile}`;
          return track;
        }
      } catch {
        continue;
      }
    }
    // Browser fallback: the public ladder can still describe the video.
    try {
      const viaProvider = await this.provider.stream(videoId);
      if (viaProvider) {
        this.lastRoute = `public API · ${this.provider.lastUsed ?? 'unknown'}`;
        return {
          id: videoId,
          title: 'Track from link',
          artist: '',
          durationSec: 0,
          thumbs: [`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`].map((url) => ({ url, width: 480, height: 360 })),
          source: 'link',
        };
      }
    } catch {
      /* nothing else to try */
    }
    return null;
  }

  /**
   * The best stream for a track. `expectedSec` is the track's own runtime; passing it lets the
   * picker reject 30-second preview clips in favour of a full-length stream.
   */
  playableUrl(info: StreamInfo, expectedSec = 0): { itag: number; url: string; preview: boolean } | undefined {
    /*
     * A natively resolved stream is not a format list, it is *a chosen stream*.
     *
     * `pickAudioUrl` ranks `info.audio` and looks the winner up in `info.urls`. The native path
     * populates both, so it works — but the itag it reports is the extractor's, not the one the caller
     * asked for, which is why callers must use this result rather than indexing `urls` with an itag
     * they picked themselves (playlist downloads used to do exactly that and would have silently found
     * nothing).
     */
    return pickAudioUrl(info, expectedSec);
  }

  /**
   * The best URL for a caller that has no opinion about format.
   *
   * Used by the playlist downloader, which asks for "a stream copy" rather than a specific itag. The
   * old code looked up a hard-coded 128 kbps itag in `urls`, which stopped working the moment the URL
   * came from a resolver that offers a different tier — and looked indistinguishable from "this track
   * cannot be downloaded".
   */
  downloadUrl(info: StreamInfo, expectedSec = 0): string | null {
    const best = this.playableUrl(info, expectedSec);
    if (best) return best.url;
    // A manifest is still a complete stream (it is described as one by `streamInfoFromNative`), so this
    // is a last resort only for shapes produced elsewhere — the InnerTube path, for instance.
    const anyUrl = Object.values(info.urls)[0];
    return anyUrl ?? null;
  }

  /** Lyrics + local index warm-up. */
  async lyricsFor(track: Track): Promise<Lyrics | null> {
    this.lastRoute = 'LRCLIB';
    const res = await getLyrics(track.title, track.artist, { durationSec: track.durationSec });
    if (!res.ok || !res.value) return null;
    const lyrics = res.value;
    if (lyrics.plain) {
      this.lyricIndex.addDoc({
        id: track.id,
        title: track.title,
        artist: track.artist,
        lyrics: lyrics.plain,
      } satisfies LyricDoc);
    }
    return lyrics;
  }

  /**
   * Fuzzy lyric recognition.
   * Stage 1: on-device BM25 over lyrics already cached on this device.
   * Stage 2: upstream text search (works surprisingly well — YouTube resolves lyric phrases).
   * Stage 3: merge, local hits first, because those are matched against real lyric bodies.
   */
  async lyricSearch(phrase: string): Promise<Track[]> {
    const localHits = this.lyricIndex.search(phrase, 8).map((h) => h.doc);
    const toTrack = (d: LyricDoc): Track => ({
      id: d.id,
      title: d.title,
      artist: d.artist,
      durationSec: 0,
      thumbs: [],
      source: 'lyric-index',
    });

    if (localHits.length >= 3) return localHits.map(toTrack);

    const upstream = await this.search(phrase, 'songs');
    const upstreamTracks =
      upstream.ok
        ? upstream.result.sections.flatMap((s) => (s.kind === 'songs' ? s.items : s.kind === 'top' ? [s.track] : []))
        : [];

    const seen = new Set<string>();
    const merged: Track[] = [];
    for (const t of [...localHits.map(toTrack), ...upstreamTracks]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      merged.push(t);
    }
    return merged.slice(0, 12);
  }

  /** Honest, user-facing description of what a download target actually does. */
  describeTarget(f: AudioFormat | VideoFormat): string {
    if ('res' in f) return f.codec.toLowerCase().startsWith('avc') ? 'Remux · no re-encode' : 'Transcode · slower';
    if (f.premiumOnly) return 'Premium only · locked';
    return f.deliver === 'url' ? 'Direct stream copy' : f.deliver === 'cipher' ? 'Needs signature' : 'Unavailable';
  }
}

/**
 * Adapt a natively resolved stream to the app's [StreamInfo] shape.
 *
 * Everything downstream (the player, the download sheet, the diagnostics lines) speaks `StreamInfo`,
 * so the native path is normalised here rather than teaching every consumer a second shape. The itag
 * and bitrate are preserved so the download sheet labels the format honestly; a manifest gets itag 0
 * and an empty format list, because a manifest is not a format — it is a container for them.
 */
/**
 * The itag used for a manifest-only stream.
 *
 * Negative because every real itag is a positive integer: a DASH or HLS manifest has no itag of its
 * own, and inventing a plausible one (140, say) would make the download sheet offer a file that does
 * not exist.
 */
const MANIFEST_ITAG = -1;

export function streamInfoFromNative(videoId: string, stream: NativeResolvedStream): StreamInfo {
  const isManifest = stream.kind !== 'progressive';

  /*
   * A manifest is a stream too, and it must be shaped like one.
   *
   * The first version of this function produced `audio: []` and no `urls` entry for DASH/HLS results,
   * so the picker found nothing to play and the app reported "this track cannot be played" for a track
   * the extractor had just resolved. From ExoPlayer's point of view a manifest is one playable track,
   * so it is described as one: a single synthesised format pointing at the manifest URL.
   *
   * A real itag is used when the resolver reported one; otherwise the key is `-1`, which is not an
   * itag any format can carry, so it cannot collide with a real entry in the same map.
   */
  const itag = isManifest && stream.itag <= 0 ? MANIFEST_ITAG : stream.itag;

  const urls: Record<number, string> = { [itag]: stream.url };

  const container: AudioFormat['container'] = stream.mime.includes('webm') ? 'webm' : 'm4a';

  const format: AudioFormat = {
    itag,
    codec: stream.codec || (isManifest ? stream.mime || 'manifest' : 'unknown'),
    nominalKbps: stream.kbps,
    actualKbps: stream.kbps,
    container,
    quality: '',
    deliver: 'url',
    premiumOnly: false,
    durationSec: stream.durationSec,
  };

  return {
    videoId,
    // The caveat rides on the profile string so every existing consumer that shows or logs a profile
    // name reports it, without adding a field to the shared domain type for a case only one resolver
    // can produce.
    profile: stream.note ? `native:${stream.source}:${stream.note}` : `native:${stream.source}`,
    audio: [format],
    video: [],
    // A progressive URL from the extractor is a plain signed URL; it outlives the play, not the day.
    expiresInSec: 6 * 3600,
    playability: 'OK',
    urls,
    // The extractor can hand back a URL that is only valid with the headers it was issued for, and
    // dropping them here made a working URL 403 in the player — which is indistinguishable from
    // "this stream is dead". Lives on the StreamInfo so it travels with the URL it belongs to.
    ...(stream.headers && Object.keys(stream.headers).length > 0 ? { headers: stream.headers } : {}),
  };
}

export const service = new MusicService();
