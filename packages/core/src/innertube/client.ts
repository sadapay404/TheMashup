/**
 * InnerTube transport: envelope construction + endpoint calls.
 *
 * Serverless constraint: this file must work identically in a browser, in Capacitor, and in Tauri.
 * It never assumes Node APIs. Transport is injected, so CORS/relay strategy is a caller concern.
 */

import type { ClientProfile, ProfileName } from './profiles.js';
import { METADATA_PROFILE, PROFILES } from './profiles.js';

export interface TransportContext {
  /** User's locale for UI strings in the payload (hl). */
  hl: string;
  /** Region (gl) — affects catalogue availability. */
  gl: string;
  /** Session-stable visitor identity. Required for consistent results and for PoToken binding. */
  visitorData?: string | undefined;
  /** Captured cookie string when signed in. */
  cookie?: string | undefined;
}

export interface InnerTubeRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: unknown;
}

export const INNERTUBE_HOST = 'https://music.youtube.com/youtubei/v1';

/**
 * Read one cookie's value out of a raw `Cookie:` header string.
 *
 * The captured header is `A=1; SAPISID=xyz; B=2`, not a map, so it has to be parsed here.
 */
function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/**
 * `Authorization: SAPISIDHASH <ts>_<sha1(ts + " " + SAPISID + " " + origin)>`
 *
 * ## Why this file was the whole problem
 *
 * Every InnerTube request was sent with a `Cookie` header and **no `Authorization` header at all**.
 * YouTube does not authenticate on the cookie alone for the web client: without this hash the request
 * is served as an anonymous visitor. That is why the account-cookie plumbing appeared to work — sign
 * in succeeded, the cookie was captured and stored — while every "personalised" thing came back
 * generic or empty: the home feed, the library playlists, the liked songs. Nothing downstream could
 * fix it, because the server never knew who was asking.
 *
 * `SAPISIDHASH` is SHA-1 over `\`${ts} ${sapisid} https://music.youtube.com\`` and the documented
 * scheme for this origin. `SAPISID` is the `__Secure-3PAPISID` sibling only for the secure origin;
 * plain `SAPISID` is correct for `music.youtube.com`.
 *
 * Uses `crypto.subtle` — present in browsers, in the Android WebView, and in Node 18+, which is every
 * runtime this file runs in. It is async for that reason, which is why `call()` became async.
 */
export async function sapisidhash(
  cookieHeader: string,
  origin = 'https://music.youtube.com',
  timestampSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  const sapisid = cookieValue(cookieHeader, 'SAPISID') ?? cookieValue(cookieHeader, '__Secure-3PAPISID');
  if (!sapisid) return null;
  const input = `${timestampSeconds} ${sapisid} ${origin}`;
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `SAPISIDHASH ${timestampSeconds}_${hex}`;
}

/** Build the exact envelope InnerTube expects. Pure function — trivially testable. */
export function buildRequest(
  profile: ClientProfile,
  endpoint: string,
  body: Readonly<Record<string, unknown>>,
  ctx: TransportContext,
): InnerTubeRequest {
  const client: Record<string, unknown> = {
    clientName: profile.clientName,
    clientVersion: profile.clientVersion,
    hl: ctx.hl,
    gl: ctx.gl,
    userAgent: profile.userAgent,
  };
  if (profile.osName) {
    client['osName'] = profile.osName;
    client['osVersion'] = profile.osVersion;
  }
  if (typeof profile.androidSdkVersion === 'number') client['androidSdkVersion'] = profile.androidSdkVersion;
  if (profile.deviceMake) client['deviceMake'] = profile.deviceMake;
  if (profile.deviceModel) client['deviceModel'] = profile.deviceModel;
  if (ctx.visitorData) client['visitorData'] = ctx.visitorData;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-YouTube-Client-Name': String(profile.clientNameId),
    'X-YouTube-Client-Version': profile.clientVersion,
    'x-origin': 'https://music.youtube.com',
  };
  if (profile.referer) headers['Referer'] = profile.referer;
  if (ctx.visitorData) headers['X-Goog-Visitor-Id'] = ctx.visitorData;
  if (ctx.cookie) headers['Cookie'] = ctx.cookie;

  return {
    url: `${INNERTUBE_HOST}/${endpoint}?alt=json&prettyPrint=false&key=${profile.apiKey}`,
    method: 'POST',
    headers,
    body: {
      context: {
        client,
        user: { lockedSafetyMode: false },
        request: { useSsl: true },
      },
      ...body,
    },
  };
}

/**
 * Search filter params — verified against ytmusicapi 1.12.3 `parsers/search.py`.
 * These are base64 protobufs; they are opaque by design, so they live as constants.
 */
export const SEARCH_PARAMS = {
  all: undefined,
  songs: 'EgWKAQIIAWoKEAUQCRADEAoYBA%3D%3D',
  videos: 'EgWKAQIQIIAWoKEAUQCRADEAoYBA%3D%3D',
  albums: 'EgWKAQIYAWoKEAUQCRADEAoYBA%3D%3D',
  artists: 'EgWKAQIgAWoKEAUQCRADEAoYBA%3D%3D',
  playlists: 'EgWKAQIoAWoKEAUQCRADEAoYBA%3D%3D',
} as const;

export type SearchFilter = keyof typeof SEARCH_PARAMS;

export interface RawResponse {
  status: number;
  json: unknown;
}

export type FetchLike = (req: InnerTubeRequest, signal?: AbortSignal) => Promise<RawResponse>;

/** Thin endpoint facade. No retry/breaker logic here — that belongs to the policy layer. */
export class InnerTube {
  constructor(
    private readonly ctx: TransportContext,
    private readonly transport: FetchLike,
    private readonly profileOf: (name: ProfileName) => ClientProfile = (n) => PROFILES[n],
  ) {}

  private async call(
    profileName: ProfileName,
    endpoint: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const request = buildRequest(this.profileOf(profileName), endpoint, body, this.ctx);
    /*
     * Sign the request when there is a session.
     *
     * Without this the server ignores the cookie and answers as an anonymous visitor. A failure to
     * hash is not an error worth throwing: an anonymous request is better than no request, and the
     * caller already handles "empty result" everywhere.
     */
    if (this.ctx.cookie) {
      try {
        const auth = await sapisidhash(this.ctx.cookie);
        if (auth) request.headers['Authorization'] = auth;
      } catch {
        /* WebCrypto unavailable — proceed anonymously rather than failing the call */
      }
    }
    return this.transport(request, signal);
  }

  search(query: string, filter: SearchFilter = 'all', continuation?: string, signal?: AbortSignal) {
    const params = SEARCH_PARAMS[filter];
    return this.call(
      METADATA_PROFILE,
      'search',
      {
        query,
        ...(params ? { params } : {}),
        ...(continuation ? { continuation } : {}),
      },
      signal,
    );
  }

  suggestions(input: string, signal?: AbortSignal) {
    return this.call(METADATA_PROFILE, 'music/get_search_suggestions', { input }, signal);
  }

  browse(browseId: string, extra: Record<string, unknown> = {}, signal?: AbortSignal) {
    return this.call(METADATA_PROFILE, 'browse', { browseId, ...extra }, signal);
  }

  /** The radio engine. `RDAMVM<videoId>` is the track-radio convention (verified in ytmusicapi). */
  next(videoId: string, playlistId?: string, signal?: AbortSignal) {
    return this.call(
      METADATA_PROFILE,
      'next',
      {
        enablePersistentPlaylistPanel: true,
        isAudioOnly: true,
        tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
        videoId,
        playlistId: playlistId ?? `RDAMVM${videoId}`,
        watchEndpointMusicSupportedConfigs: {
          watchEndpointMusicConfig: {
            hasPersistentPlaylistPanel: true,
            musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
          },
        },
      },
      signal,
    );
  }

  /** Streaming formats. Caller walks STREAM_LADDER, not this method. */
  player(profileName: ProfileName, videoId: string, signal?: AbortSignal) {
    return this.call(
      profileName,
      'player',
      {
        videoId,
        playbackContext: { contentPlaybackContext: { signatureTimestamp: 0 } },
        contentCheckOk: true,
        racyCheckOk: true,
      },
      signal,
    );
  }
}
