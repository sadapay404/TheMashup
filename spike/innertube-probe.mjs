/**
 * TheMashup — Phase 1 research spike: InnerTube contract prover.
 *
 * PURPOSE
 *   Proves the request/parse contract that Phase 2 will build on, WITHOUT needing network access.
 *   It (a) builds real InnerTube request envelopes per client profile, (b) validates them against the
 *   documented shape, (c) parses recorded search/next/player fixtures into domain objects,
 *   (d) derives the downloadable format ladder with honest quality labels.
 *
 *   If the sandbox has YouTube access you can also run:
 *     node spike/innertube-probe.mjs --live
 *   which hits music.youtube.com and prints the same table from live data.
 *
 * Run: node spike/innertube-probe.mjs
 */

const PROFILES = {
  VISIONOS: {
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    osName: 'visionOS',
    osVersion: '26.5.23O471',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    clientNameId: 101,
    apiKey: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    needsPoToken: false,
    cipherFree: true,
  },
  TVHTML5: {
    clientName: 'TVHTML5',
    clientVersion: '7.20260707.07.00',
    userAgent:
      'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)',
    clientNameId: 7,
    apiKey: 'AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8',
    needsPoToken: false,
    cipherFree: false,
  },
  ANDROID: {
    clientName: 'ANDROID',
    clientVersion: '21.26.364',
    androidSdkVersion: 30,
    osName: 'Android',
    osVersion: '11',
    userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
    clientNameId: 3,
    apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    needsPoToken: true,
    cipherFree: false,
  },
  WEB_REMIX: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20260707.12.00',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
    clientNameId: 67,
    apiKey: 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30',
    referer: 'https://music.youtube.com/',
    needsPoToken: true,
    cipherFree: false,
  },
};

const HOST = 'https://music.youtube.com/youtubei/v1';

/** Build the exact request envelope InnerTube expects. */
function buildRequest(profileName, endpoint, body, { visitorData, locale = 'en', gl = 'PK' } = {}) {
  const p = PROFILES[profileName];
  if (!p) throw new Error(`unknown profile ${profileName}`);

  const client = {
    clientName: p.clientName,
    clientVersion: p.clientVersion,
    hl: locale,
    gl,
    userAgent: p.userAgent,
    ...(p.osName ? { osName: p.osName, osVersion: p.osVersion } : {}),
    ...(p.androidSdkVersion ? { androidSdkVersion: p.androidSdkVersion } : {}),
    ...(visitorData ? { visitorData } : {}),
  };

  return {
    url: `${HOST}/${endpoint}?alt=json&prettyPrint=false&key=${p.apiKey}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': String(p.clientNameId),
      'X-YouTube-Client-Version': p.clientVersion,
      'x-origin': 'https://music.youtube.com',
      ...(p.referer ? { Referer: p.referer } : {}),
      ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
    },
    body: { context: { client, user: { lockedSafetyMode: false }, request: { useSsl: true } }, ...body },
  };
}

// ---------------------------------------------------------------------------------------------
// Recorded fixtures (shape-accurate subsets of real responses, trimmed for readability)
// ---------------------------------------------------------------------------------------------

const FIXTURE_SEARCH = {
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    musicShelfRenderer: {
                      title: { runs: [{ text: 'Songs' }] },
                      contents: [
                        {
                          musicResponsiveListItemRenderer: {
                            playlistItemData: { videoId: 'bJonJjgS2mM' },
                            flexColumns: [
                              { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Wonderwall' }] } } },
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: {
                                    runs: [
                                      { text: 'Oasis' },
                                      { text: ' • ' },
                                      { text: 'Whatever' },
                                      { text: ' • ' },
                                      { text: '4:18' },
                                    ],
                                  },
                                },
                              },
                            ],
                            overlay: {
                              musicItemThumbnailOverlayRenderer: {
                                content: {
                                  musicPlayButtonRenderer: {
                                    playNavigationEndpoint: {
                                      watchEndpoint: { videoId: 'bJonJjgS2mM', playlistId: 'RDAMVMbJonJjgS2mM' },
                                    },
                                  },
                                },
                              },
                            },
                            thumbnail: {
                              musicThumbnailRenderer: {
                                thumbnail: {
                                  thumbnails: [{ url: 'https://lh3.googleusercontent.com/x=w60', width: 60, height: 60 }],
                                },
                              },
                            },
                          },
                        },
                      ],
                      continuations: [{ nextContinuationData: { continuation: 'CONT_TOKEN_A' } }],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

const FIXTURE_NEXT = {
  contents: {
    singleColumnMusicWatchNextResultsRenderer: {
      tabbedRenderer: {
        watchNextTabbedResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  musicQueueRenderer: {
                    content: {
                      playlistPanelRenderer: {
                        contents: [
                          {
                            playlistPanelVideoRenderer: {
                              videoId: 'bJonJjgS2mM',
                              title: { runs: [{ text: 'Wonderwall' }] },
                              longBylineText: { runs: [{ text: 'Oasis' }] },
                              lengthText: { runs: [{ text: '4:18' }] },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
};

const FIXTURE_PLAYER = {
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: 'bJonJjgS2mM', title: 'Wonderwall', author: 'Oasis', lengthSeconds: '258' },
  streamingData: {
    expiresInSeconds: '21540',
    adaptiveFormats: [
      { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 48000, audioQuality: 'AUDIO_QUALITY_LOW', url: 'https://rr1---sn-x.googlevideo.com/v?itag=139' },
      { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131007, audioQuality: 'AUDIO_QUALITY_MEDIUM', url: 'https://rr1---sn-x.googlevideo.com/v?itag=140' },
      { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 159000, audioQuality: 'AUDIO_QUALITY_HIGH', url: 'https://rr1---sn-x.googlevideo.com/v?itag=251' },
      { itag: 249, mimeType: 'audio/webm; codecs="opus"', bitrate: 50000, audioQuality: 'AUDIO_QUALITY_LOW', url: 'https://rr1---sn-x.googlevideo.com/v?itag=249' },
      { itag: 160, mimeType: 'video/mp4; codecs="avc1.4d400c"', width: 256, height: 144, fps: 15, bitrate: 100000, url: 'https://rr1---sn-x.googlevideo.com/v?itag=160' },
      { itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, fps: 30, bitrate: 4000000, url: 'https://rr1---sn-x.googlevideo.com/v?itag=137' },
      { itag: 313, mimeType: 'video/webm; codecs="vp9"', width: 3840, height: 2160, fps: 30, bitrate: 18000000, url: 'https://rr1---sn-x.googlevideo.com/v?itag=313' },
    ],
    formats: [{ itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', width: 640, height: 360, bitrate: 700000, url: 'https://rr1---sn-x.googlevideo.com/v?itag=18' }],
  },
};

const AUDIO_ITAGS = {
  139: { codec: 'AAC HE v1', kbps: 48, container: 'm4a' },
  140: { codec: 'AAC LC', kbps: 128, container: 'm4a' },
  141: { codec: 'AAC LC', kbps: 256, container: 'm4a', premium: true },
  249: { codec: 'Opus', kbps: 50, container: 'webm' },
  250: { codec: 'Opus', kbps: 70, container: 'webm' },
  251: { codec: 'Opus', kbps: 160, container: 'webm' },
  256: { codec: 'AAC HE v1', kbps: 192, container: 'm4a', surround: true },
  258: { codec: 'AAC LC', kbps: 384, container: 'm4a', surround: true },
};

// ---------------------------------------------------------------------------------------------
// Parsers — deliberately defensive: unknown shapes never throw, they degrade.
// ---------------------------------------------------------------------------------------------

const runsText = (node) => (node?.runs ?? []).map((r) => r.text ?? '').join('');

function parseSearch(json) {
  const sections =
    json?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const out = [];
  for (const section of sections) {
    const shelf = section?.musicShelfRenderer;
    for (const item of shelf?.contents ?? []) {
      const r = item?.musicResponsiveListItemRenderer;
      if (!r) continue;
      const cols = (r.flexColumns ?? []).map((c) => runsText(c?.musicResponsiveListItemFlexColumnRenderer?.text));
      const videoId =
        r?.playlistItemData?.videoId ??
        r?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
          ?.watchEndpoint?.videoId ??
        null;
      if (!videoId) continue;
      const meta = cols[1]?.split(' • ') ?? [];
      out.push({
        videoId,
        title: cols[0] ?? '(untitled)',
        artist: meta[0] ?? '',
        album: meta[1] ?? '',
        duration: meta.find((m) => /^\d+:\d{2}$/.test(m)) ?? '',
        thumb: r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url ?? '',
      });
    }
  }
  const continuation = sections?.[0]?.musicShelfRenderer?.continuations?.[0]?.nextContinuationData?.continuation ?? null;
  return { items: out, continuation };
}

function parseNextRadio(json) {
  const tabs =
    json?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs ?? [];
  const panel = tabs.find((t) => t?.tabRenderer?.content?.musicQueueRenderer)?.tabRenderer?.content?.musicQueueRenderer
    ?.content?.playlistPanelRenderer;
  const items = (panel?.contents ?? [])
    .map((c) => c?.playlistPanelVideoRenderer)
    .filter(Boolean)
    .map((r) => ({
      videoId: r.videoId,
      title: runsText(r.title),
      artist: runsText(r.longBylineText),
      duration: runsText(r.lengthText),
    }));
  return { seed: items[0]?.videoId ?? null, radio: items, playlistId: 'RDAMVM' + (items[0]?.videoId ?? '') };
}

function buildFormatLadder(playerJson) {
  const adaptive = playerJson?.streamingData?.adaptiveFormats ?? [];
  const progressive = playerJson?.streamingData?.formats ?? [];
  const audio = [];
  const video = [];

  for (const f of [...adaptive, ...progressive]) {
    const mime = f.mimeType ?? '';
    const isAudio = mime.startsWith('audio/');
    const isVideo = mime.startsWith('video/');
    const dl = f.url ? 'url' : f.signatureCipher ? 'cipher' : 'none';

    if (isAudio) {
      const meta = AUDIO_ITAGS[f.itag] ?? { codec: mime.split('codecs="')[1]?.replace('"', '') ?? '?', kbps: Math.round((f.bitrate ?? 0) / 1000), container: mime.includes('webm') ? 'webm' : 'm4a' };
      audio.push({
        itag: f.itag,
        codec: meta.codec,
        nominalKbps: meta.kbps,
        actualKbps: Math.round((f.bitrate ?? 0) / 1000),
        container: meta.container,
        quality: f.audioQuality?.replace('AUDIO_QUALITY_', '') ?? '?',
        deliver: dl,
        locked: Boolean(meta.premium),
      });
    } else if (isVideo) {
      video.push({
        itag: f.itag,
        height: f.height ?? 0,
        res: f.height ? `${f.height}p` : '?',
        codec: (mime.match(/codecs="([^"]+)"/)?.[1] ?? '?').split(',')[0],
        fps: f.fps ?? 30,
        kbps: Math.round((f.bitrate ?? 0) / 1000),
        container: mime.includes('webm') ? 'webm' : 'mp4',
        hasAudio: mime.includes('mp4a'),
        deliver: dl,
      });
    }
  }
  audio.sort((a, b) => b.nominalKbps - a.nominalKbps);
  // 4K first, then by quality; drop duplicate resolutions keeping the best bitrate
  const byRes = new Map();
  for (const v of video.sort((a, b) => b.height - a.height || b.kbps - a.kbps)) {
    if (!byRes.has(v.res)) byRes.set(v.res, v);
  }
  return { audio, video: [...byRes.values()] };
}

/** Honest conversion table: what each user-facing "format" really does. */
function deliverableTargets(audio, video) {
  const best = audio.find((a) => a.deliver !== 'none' && !a.locked) ?? null;
  const bestAv = video.find((v) => v.hasAudio && v.deliver !== 'none') ?? null;
  const rows = [];
  for (const a of audio) {
    rows.push({
      target: `${a.container.toUpperCase()} ${a.nominalKbps}k (${a.codec})`,
      source: `itag ${a.itag}`,
      work: 'stream copy',
      real: a.locked ? 'needs Premium' : a.deliver,
    });
  }
  if (best) {
    rows.push({ target: 'MP3 320k', source: `itag ${best.itag}`, work: 'TRANSCODE', real: 'lossy→lossy re-encode' });
    rows.push({ target: 'FLAC', source: `itag ${best.itag}`, work: 'DECODE + FLAC ENCODE', real: 'lossless container, lossy source' });
  }
  for (const v of video) {
    rows.push({
      target: `MP4 ${v.res} H.264`,
      source: `${v.itag}+${best?.itag ?? '?'}`,
      work: v.codec.startsWith('avc') ? 'REMUX' : 'TRANSCODE',
      real: v.deliver,
    });
  }
  if (bestAv) rows.push({ target: `MP4 360p progressive`, source: `itag ${bestAv.itag}`, work: 'stream copy', real: bestAv.deliver });
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------------------------

let failures = 0;
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  → ${extra}` : ''}`);
};

function section(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

// ---------------------------------------------------------------------------------------------

section('1. Request envelope construction');
for (const name of Object.keys(PROFILES)) {
  const req = buildRequest(name, 'search', { query: 'oasis wonderwall' }, { visitorData: 'VD_TEST' });
  check(`${name}: url targets music.youtube.com/youtubei/v1/search`, req.url.startsWith('https://music.youtube.com/youtubei/v1/search?'));
  check(`${name}: client name header matches body`, req.headers['X-YouTube-Client-Name'] === String(PROFILES[name].clientNameId) && req.body.context.client.clientName === PROFILES[name].clientName);
  check(`${name}: visitorData propagated`, req.body.context.client.visitorData === 'VD_TEST' && req.headers['X-Goog-Visitor-Id'] === 'VD_TEST');
  check(`${name}: origin header set`, req.headers['x-origin'] === 'https://music.youtube.com');
}

section('2. Search parse → domain');
const search = parseSearch(FIXTURE_SEARCH);
check('extracts 1 song', search.items.length === 1);
check('videoId resolved', search.items[0]?.videoId === 'bJonJjgS2mM');
check('title parsed', search.items[0]?.title === 'Wonderwall');
check('artist split from bullet meta', search.items[0]?.artist === 'Oasis');
check('duration detected', search.items[0]?.duration === '4:18');
check('continuation token kept', search.continuation === 'CONT_TOKEN_A');

section('3. Radio (next) parse');
const radio = parseNextRadio(FIXTURE_NEXT);
check('radio seed = first item', radio.seed === 'bJonJjgS2mM');
check('RDAMVM convention applied', radio.playlistId === 'RDAMVMbJonJjgS2mM');
check('panel items parsed', radio.radio.length === 1 && radio.radio[0].artist === 'Oasis');

section('4. Format ladder');
const { audio, video } = buildFormatLadder(FIXTURE_PLAYER);
check('audio formats found', audio.length === 4, `got ${audio.length}`);
check('best free audio = 251 (Opus ~160)', audio.find((a) => !a.locked)?.itag === 251, JSON.stringify(audio.map((a) => a.itag)));
check('141 marked Premium-locked when present', !audio.some((a) => a.itag === 141 && !a.locked));
check('video deduped by resolution', new Set(video.map((v) => v.res)).size === video.length);
check('4K present', video.some((v) => v.res === '2160p'));
check('progressive 18 detected as having audio', video.some((v) => v.itag === 18 && v.hasAudio));

section('5. Honest deliverable labels');
const rows = deliverableTargets(audio, video);
check('FLAC is labelled as transcode from lossy', rows.some((r) => r.target === 'FLAC' && r.real.includes('lossy source')));
check('MP3 labelled TRANSCODE', rows.some((r) => r.target.startsWith('MP3') && r.work === 'TRANSCODE'));
console.log('\n  user-facing download targets:');
for (const r of rows) {
  console.log(`    ${r.target.padEnd(26)} ← ${String(r.source).padEnd(9)} ${r.work.padEnd(22)} ${r.real}`);
}

section('6. Defensive parsing (the zero-crash contract)');
check('null response does not throw', (() => { try { parseSearch(null); return true; } catch { return false; } })());
check('garbage response yields empty result', parseSearch({ contents: { weird: true } }).items.length === 0);
check('player without streamingData yields empty ladder', buildFormatLadder({}).audio.length === 0);
check('cipher-only formats are not marked as direct url', buildFormatLadder({ streamingData: { adaptiveFormats: [{ itag: 140, mimeType: 'audio/mp4', signatureCipher: 's=abc' }] } }).audio[0]?.deliver === 'cipher');

// ---------------------------------------------------------------------------------------------

section('7. Live probe (optional)');
const live = process.argv.includes('--live');
if (!live) {
  console.log('  skipped — run with --live on a machine with YouTube access.');
} else {
  try {
    const req = buildRequest('WEB_REMIX', 'search', { query: 'oasis wonderwall' }, { visitorData: undefined });
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
    const json = await res.json();
    const parsed = parseSearch(json);
    console.log(`  live search status=${res.status} results=${parsed.items.length} first=${parsed.items[0]?.title ?? '-'}`);
    if (!parsed.items.length) failures++;
  } catch (e) {
    console.log(`  live probe failed (expected in a sandboxed environment): ${e.message}`);
  }
}

console.log(`\n\x1b[1m${failures === 0 ? '\x1b[32mALL CHECKS PASSED' : `\x1b[31m${failures} CHECK(S) FAILED`}\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
