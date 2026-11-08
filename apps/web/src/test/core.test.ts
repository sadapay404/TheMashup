/**
 * Engine tests: the zero-crash contract, proven against hostile input.
 * These are the tests that keep the "no white screens" promise honest.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  LyricIndex,
  parsePlayer,
  parseRadioQueue,
  parseSearch,
  pickAudioUrl,
  PROFILES,
  TokenBucket,
  CircuitBreaker,
  backoffDelay,
  parseSyncedLyrics,
  activeLineIndex,
  tokenize,
  looksLikeLyrics,
  applyEvent,
  emptyAffinity,
  rankQueue,
  err,
  ok,
  humanize,
  toAppError,
} from '@themashup/core';

describe('InnerTube envelope', () => {
  it('builds a request whose header and body client names agree', () => {
    const req = buildRequest(PROFILES.WEB_REMIX, 'search', { query: 'x' }, { hl: 'en', gl: 'PK', visitorData: 'v1' });
    expect(req.url).toContain('music.youtube.com/youtubei/v1/search');
    expect(req.headers['X-YouTube-Client-Name']).toBe('67');
    const body = req.body as { context: { client: { clientName: string; visitorData: string } } };
    expect(body.context.client.clientName).toBe('WEB_REMIX');
    expect(body.context.client.visitorData).toBe('v1');
    expect(req.headers['X-Goog-Visitor-Id']).toBe('v1');
  });

  it('omits android-only fields for web profiles', () => {
    const req = buildRequest(PROFILES.WEB_REMIX, 'player', {}, { hl: 'en', gl: 'US' });
    const client = (req.body as { context: { client: Record<string, unknown> } }).context.client;
    expect(client['androidSdkVersion']).toBeUndefined();
    expect(client['osName']).toBeUndefined();
  });

  it('includes android fields for android profiles', () => {
    const req = buildRequest(PROFILES.ANDROID, 'player', {}, { hl: 'en', gl: 'US' });
    const client = (req.body as { context: { client: Record<string, unknown> } }).context.client;
    expect(client['androidSdkVersion']).toBe(30);
    expect(client['osName']).toBe('Android');
  });
});

describe('parsers never throw', () => {
  const hostile: unknown[] = [null, undefined, 0, '', 'str', [], {}, { contents: null }, { contents: { x: 1 } }, NaN];

  it.each(hostile.map((h, i) => [i, h]))('parseSearch(%i) is total', (_i, input) => {
    expect(() => parseSearch(input)).not.toThrow();
    expect(parseSearch(input).sections).toEqual([]);
  });

  it.each(hostile.map((h, i) => [i, h]))('parseRadioQueue(%i) is total', (_i, input) => {
    expect(() => parseRadioQueue(input)).not.toThrow();
    expect(parseRadioQueue(input)).toEqual([]);
  });

  it.each(hostile.map((h, i) => [i, h]))('parsePlayer(%i) is total', (_i, input) => {
    expect(() => parsePlayer(input, 'VISIONOS', 'abc')).not.toThrow();
    expect(parsePlayer(input, 'VISIONOS', 'abc').audio).toEqual([]);
  });

  it('parses a realistic search payload', () => {
    const payload = {
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
                          contents: [
                            {
                              musicResponsiveListItemRenderer: {
                                playlistItemData: { videoId: 'abc123def45' },
                                flexColumns: [
                                  { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song A' }] } } },
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: { runs: [{ text: 'Artist A • Album A • 3:45' }] },
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                          continuations: [{ nextContinuationData: { continuation: 'TOKEN' } }],
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
    const out = parseSearch(payload);
    expect(out.continuation).toBe('TOKEN');
    const songs = out.sections.find((s) => s.kind === 'songs');
    expect(songs && 'items' in songs ? songs.items[0]?.title : null).toBe('Song A');
    expect(songs && 'items' in songs ? songs.items[0]?.durationSec : 0).toBe(225);
  });
});

describe('format ladder honesty', () => {
  it('marks premium itags as locked and prefers free tiers', () => {
    const info = parsePlayer(
      {
        streamingData: {
          adaptiveFormats: [
            { itag: 141, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 256000, url: 'https://x/?itag=141' },
            { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://x/?itag=251' },
          ],
        },
      },
      'VISIONOS',
      'v',
    );
    const best = pickAudioUrl(info);
    expect(best?.itag).toBe(251); // never silently hand back a Premium-only tier
    expect(info.audio.find((a) => a.itag === 141)?.premiumOnly).toBe(true);
  });

  it('reports ciphered formats as cipher rather than hiding them', () => {
    const info = parsePlayer(
      { streamingData: { adaptiveFormats: [{ itag: 140, mimeType: 'audio/mp4', signatureCipher: 's=x' }] } },
      'WEB_REMIX',
      'v',
    );
    expect(info.audio[0]?.deliver).toBe('cipher');
    expect(pickAudioUrl(info)).toBeUndefined();
  });
});

describe('policy layer', () => {
  it('backs off exponentially within bounds and adds jitter', () => {
    const lo = backoffDelay(3, { baseMs: 400, maxMs: 30000, jitter: 0 }, () => 0);
    expect(lo).toBe(3200);
    const capped = backoffDelay(20, { baseMs: 400, maxMs: 30000, jitter: 0 }, () => 0);
    expect(capped).toBe(30000);
    const jittered = backoffDelay(0, { baseMs: 1000, jitter: 0.3 }, () => 0.5);
    expect(jittered).toBe(1000);
  });

  it('token bucket refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 10, { now: () => now, sleep: async () => undefined });
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    now += 500; // 0.5s * 10/s = 5 tokens available (capped at 2)
    expect(bucket.tryTake()).toBe(true);
  });

  it('circuit breaker opens then allows a half-open probe', () => {
    let now = 0;
    const cb = new CircuitBreaker(2, 1000, { now: () => now, sleep: async () => undefined });
    expect(cb.canAttempt()).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.canAttempt()).toBe(false);
    now += 1001;
    expect(cb.canAttempt()).toBe(true); // half-open
    cb.recordSuccess();
    expect(cb.current).toBe('closed');
  });
});

describe('lyrics', () => {
  it('parses LRC with multi-timestamps and offset', () => {
    const lines = parseSyncedLyrics('[offset:500]\n[00:10.00][00:30.00]hello\n[00:20.5]world');
    // Sorted by time: 10.5 (hello), 21.0 (world), 30.5 (hello)
    expect(lines).toHaveLength(3);
    expect(lines[0]?.t).toBeCloseTo(10.5, 2);
    expect(lines[0]?.text).toBe('hello');
    expect(lines[1]?.t).toBeCloseTo(21, 2);
    expect(lines[1]?.text).toBe('world');
    expect(lines[2]?.t).toBeCloseTo(30.5, 2);
  });

  it('finds the active line at a timestamp', () => {
    const lines = parseSyncedLyrics('[00:01.00]a\n[00:05.00]b\n[00:09.00]c');
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 6)).toBe(1);
    expect(activeLineIndex(lines, 99)).toBe(2);
  });

  it('indexes and matches lyric bodies with typos', () => {
    const idx = new LyricIndex([
      { id: 'a', title: 'Bohemian Rhapsody', artist: 'Queen', lyrics: 'Caught in a landslide no escape from reality' },
      { id: 'b', title: 'Fix You', artist: 'Coldplay', lyrics: 'When you try your best but you dont succeed' },
    ]);
    expect(idx.search('landslide no escape')[0]?.doc.title).toBe('Bohemian Rhapsody');
    expect(idx.search('knees wek')[0]).toBeUndefined(); // not in corpus
    expect(idx.search('try your best but you dont succed')[0]?.doc.title).toBe('Fix You');
    expect(idx.search('')).toEqual([]);
  });

  it('classifies lyric-like input without false positives on titles', () => {
    expect(looksLikeLyrics('caught in a landslide no escape from reality')).toBe(true);
    expect(looksLikeLyrics('oasis wonderwall')).toBe(false);
    expect(tokenize('Is this the real life')).toEqual(['real', 'life']);
  });
});

describe('recommender invariants', () => {
  const mk = (id: string, artist: string) => ({
    id,
    title: `t-${id}`,
    artist,
    durationSec: 200,
    thumbs: [],
  });

  it('never plays three of the same artist consecutively', () => {
    const candidates = [mk('1', 'X'), mk('2', 'X'), mk('3', 'X'), mk('4', 'X'), mk('5', 'Y')];
    const ranked = rankQueue(candidates, emptyAffinity(), { seedArtist: 'X', now: 0, epsilon: 0, limit: 5 });
    const artistSeq = ranked.map((r) => r.artist);
    for (let i = 2; i < artistSeq.length; i++) {
      expect(artistSeq[i] === artistSeq[i - 1] && artistSeq[i] === artistSeq[i - 2]).toBe(false);
    }
  });

  it('is deterministic for a fixed epsilon and RNG', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => mk(`${i}`, `A${i % 4}`));
    const a = rankQueue(candidates, emptyAffinity(), { seedArtist: 'A0', now: 0, epsilon: 0, limit: 8 });
    const b = rankQueue(candidates, emptyAffinity(), { seedArtist: 'A0', now: 0, epsilon: 0, limit: 8 });
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  it('applies negative feedback without throwing', () => {
    let state = emptyAffinity();
    state = applyEvent(state, { type: 'lessLikeThis', track: mk('1', 'X'), now: 1 });
    expect(state.artists['X']).toBe(-5);
    const ranked = rankQueue([mk('1', 'X'), mk('2', 'Y')], state, { seedArtist: 'Y', now: 1, epsilon: 0 });
    expect(ranked[0]?.artist).toBe('Y');
  });

  it('handles an empty candidate pool', () => {
    expect(rankQueue([], emptyAffinity(), { seedArtist: 'x', now: 0 })).toEqual([]);
  });
});

describe('Result / error surface', () => {
  it('humanizes every error kind with an actionable sentence', () => {
    const kinds = ['Network', 'Cors', 'Upstream', 'Parse', 'Auth', 'Playability', 'Storage', 'Capability', 'Cancelled', 'Unknown'] as const;
    for (const k of kinds) {
      const e = toAppError({ k, retryable: false, message: 'x' });
      const h = humanize(e);
      expect(h.title.length).toBeGreaterThan(0);
      expect(h.action.length).toBeGreaterThan(0);
    }
  });

  it('turns a thrown DOMException abort into Cancelled', () => {
    const e = toAppError(new DOMException('aborted', 'AbortError'));
    expect(e.k).toBe('Cancelled');
  });

  it('treats a fetch failure as a CORS/network error', () => {
    expect(toAppError(new TypeError('Failed to fetch')).k).toBe('Cors');
  });

  it('ok/err compose', () => {
    expect(ok(1).ok).toBe(true);
    expect(err({ k: 'Cancelled', retryable: false, message: 'x' }).ok).toBe(false);
  });
});
