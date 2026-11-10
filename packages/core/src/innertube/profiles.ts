/**
 * Client profiles — DATA, not code (Amendment A-3).
 *
 * These strings rot. Keeping them in one exported table means a single edit (or a remote refresh
 * from a static JSON, or a user override in Settings) fixes the whole app when YouTube bumps a
 * version. Verified against yt-dlp `INNERTUBE_CLIENTS` and InnerTune `YouTubeClient.kt`.
 */

export type ProfileName =
  | 'WEB_REMIX'
  | 'VISIONOS'
  | 'TVHTML5'
  | 'TVHTML5_SIMPLY'
  | 'ANDROID'
  | 'ANDROID_VR'
  | 'IOS'
  | 'MWEB';

export interface ClientProfile {
  readonly name: ProfileName;
  readonly clientName: string;
  readonly clientVersion: string;
  /** Numeric X-YouTube-Client-Name header value. */
  readonly clientNameId: number;
  readonly apiKey: string;
  readonly userAgent: string;
  readonly referer?: string;
  readonly osName?: string;
  readonly osVersion?: string;
  readonly androidSdkVersion?: number;
  readonly deviceMake?: string;
  readonly deviceModel?: string;
  /** True when streaming formats require a BotGuard (GVS) PoToken. */
  readonly needsStreamPoToken: boolean;
  /** True when the profile can return direct URLs without JS signature deciphering. */
  readonly cipherFree: boolean;
  /** What this profile is best at. Drives the role split in the resolution ladder. */
  readonly role: 'metadata' | 'stream' | 'both';
}

export const PROFILES: Readonly<Record<ProfileName, ClientProfile>> = {
  WEB_REMIX: {
    name: 'WEB_REMIX',
    clientName: 'WEB_REMIX',
    clientVersion: '1.20260707.12.00',
    clientNameId: 67,
    apiKey: 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    referer: 'https://music.youtube.com/',
    needsStreamPoToken: true,
    cipherFree: false,
    role: 'metadata',
  },
  VISIONOS: {
    name: 'VISIONOS',
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    clientNameId: 101,
    apiKey: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    osName: 'visionOS',
    osVersion: '26.5.23O471',
    needsStreamPoToken: false,
    cipherFree: true,
    role: 'stream',
  },
  TVHTML5: {
    name: 'TVHTML5',
    clientName: 'TVHTML5',
    clientVersion: '7.20260707.07.00',
    clientNameId: 7,
    apiKey: 'AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8',
    userAgent:
      'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)',
    needsStreamPoToken: false,
    cipherFree: false,
    role: 'stream',
  },
  ANDROID: {
    name: 'ANDROID',
    clientName: 'ANDROID',
    clientVersion: '21.26.364',
    clientNameId: 3,
    apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
    osName: 'Android',
    osVersion: '11',
    androidSdkVersion: 30,
    needsStreamPoToken: true,
    cipherFree: false,
    role: 'stream',
  },
  IOS: {
    name: 'IOS',
    clientName: 'IOS',
    clientVersion: '21.26.4',
    clientNameId: 5,
    apiKey: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    userAgent: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    osName: 'iPhone',
    osVersion: '18.3.2.22D82',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    needsStreamPoToken: true,
    cipherFree: false,
    role: 'stream',
  },
  /**
   * The TV client without a real Smart-TV handshake.
   *
   * The regular TVHTML5 player needs the pairing flow, so it is metadata-only for us. This variant
   * skips the handshake entirely and is the client that, historically, never asked for a PoToken
   * because a TV set has no place to run BotGuard.
   */
  TVHTML5_SIMPLY: {
    name: 'TVHTML5_SIMPLY',
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientVersion: '2.0',
    clientNameId: 85,
    apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    userAgent:
      'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)',
    referer: 'https://www.youtube.com/',
    needsStreamPoToken: false,
    cipherFree: true,
    role: 'stream',
  },
  /**
   * The Quest client, pinned to an OLD version on purpose.
   *
   * yt-dlp's client table carries a warning worth repeating: `clientVersion > 1.65` may return SABR
   * streams only, and newer builds started demanding a GVS PoToken. 1.65.10 is the last version
   * known to hand back plain, unauthenticated media URLs for the whole file. Do not "update" this
   * string without re-testing that a full track still plays — a newer number here is what breaks
   * playback, not what fixes it.
   */
  ANDROID_VR: {
    name: 'ANDROID_VR',
    clientName: 'ANDROID_VR',
    clientVersion: '1.65.10',
    clientNameId: 28,
    apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    osName: 'Android',
    osVersion: '12L',
    androidSdkVersion: 32,
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    needsStreamPoToken: false,
    cipherFree: true,
    role: 'stream',
  },
  MWEB: {
    name: 'MWEB',
    clientName: 'MWEB',
    clientVersion: '2.20260708.05.00',
    clientNameId: 2,
    apiKey: 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30',
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)',
    needsStreamPoToken: true,
    cipherFree: false,
    role: 'metadata',
  },
};

/**
 * Stream resolution order.
 *
 * The ordering is the whole fix for "songs stop after thirty seconds", so it is worth being precise
 * about why this order and not another.
 *
 *  - **VISIONOS** is first. It is the client yt-dlp moved to as its JavaScript-free default, and the
 *    one this app's own diagnostics measurably resolve on the user's device: 27 formats, direct URLs.
 *    Verified on hardware, not assumed.
 *  - **ANDROID_VR** and **TVHTML5_SIMPLY** follow: both token-free in principle. VR is pinned to an
 *    old version on purpose (see its entry).
 *  - **TVHTML5** is next *only* because it is token-free. On the user's device it returns zero usable
 *    formats — every one ciphered — so it cannot be the first rung, whatever the tables say.
 *  - **IOS / ANDROID / WEB_REMIX** last: they need a stream PoToken, which we cannot mint. A response
 *    from these yields a URL that serves roughly one megabyte and then answers 403. Best-effort only.
 *
 * What to measure if this regresses: `pickStreamFromLadder` reports how many formats each rung
 * returned and how many were blocked, and Settings shows the same numbers the player will see.
 */
export const STREAM_LADDER: readonly ProfileName[] = [
  'VISIONOS',
  'ANDROID_VR',
  'TVHTML5_SIMPLY',
  'TVHTML5',
  'IOS',
  'ANDROID',
  'WEB_REMIX',
];

export const METADATA_PROFILE: ProfileName = 'WEB_REMIX';
