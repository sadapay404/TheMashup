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

  private call(profileName: ProfileName, endpoint: string, body: Record<string, unknown>, signal?: AbortSignal) {
    return this.transport(buildRequest(this.profileOf(profileName), endpoint, body, this.ctx), signal);
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
