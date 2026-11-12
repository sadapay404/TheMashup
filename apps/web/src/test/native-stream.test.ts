/**
 * The seam between the K class that resolves a stream and the code that plays or downloads it.
 *
 * Every test here covers a way a *successful* resolution used to become *silence*:
 *
 *  - headers dropped on conversion → the CDN answers 403 → "this stream is dead";
 *  - a DASH/HLS manifest converted with `audio: []` → the picker finds nothing → "cannot be played";
 *  - a manifest's itag invented as a plausible real one → the download sheet offers a file that
 *    cannot be fetched;
 *  - a preview clip offered as a full track.
 *
 * The converter is exported for these tests and for the diagnostics screen; it is pure, so a native
 * resolve can be replayed from a boot log without a device.
 */

import { describe, expect, it } from 'vitest';
import type { NativeResolvedStream } from '../lib/native';
import { streamInfoFromNative } from '../lib/service';
import { pickAudioUrl } from '@themashup/core';

const progressive = (over: Partial<NativeResolvedStream> = {}): NativeResolvedStream => ({
  url: 'https://rr1.googlevideo.com/videoplayback?itag=140',
  kind: 'progressive',
  itag: 140,
  codec: 'audio/mp4',
  kbps: 128,
  mime: 'audio/mp4',
  durationSec: 213,
  headers: {},
  source: 'newpipe',
  ...over,
});

describe('streamInfoFromNative', () => {
  it('produces a format the picker can actually select', () => {
    const info = streamInfoFromNative('vid', progressive());
    const picked = pickAudioUrl(info, 213);
    expect(picked?.itag).toBe(140);
    expect(picked?.url).toBe('https://rr1.googlevideo.com/videoplayback?itag=140');
    expect(picked?.preview).toBe(false);
  });

  it('keeps the headers that make the URL valid, on the object that carries the URL', () => {
    const info = streamInfoFromNative(
      'vid',
      progressive({ headers: { Referer: 'https://www.youtube.com/' } }),
    );
    expect(info.headers).toEqual({ Referer: 'https://www.youtube.com/' });
  });

  it('omits the headers key entirely when the resolver reported none', () => {
    const info = streamInfoFromNative('vid', progressive());
    expect('headers' in info).toBe(false);
  });

  it('describes a DASH manifest as one playable track instead of an empty list', () => {
    const info = streamInfoFromNative(
      'vid',
      progressive({
        url: 'https://example.test/manifest.mpd',
        kind: 'dash',
        itag: 0,
        mime: 'application/dash+xml',
        kbps: 0,
      }),
    );
    expect(info.audio).toHaveLength(1);
    const picked = pickAudioUrl(info, 200);
    expect(picked?.url).toBe('https://example.test/manifest.mpd');
  });

  it('describes an HLS manifest the same way', () => {
    const info = streamInfoFromNative(
      'vid',
      progressive({ url: 'https://example.test/m.m3u8', kind: 'hls', itag: 0, mime: 'application/x-mpegURL' }),
    );
    expect(pickAudioUrl(info, 200)?.url).toBe('https://example.test/m.m3u8');
  });

  it('gives a manifest a negative key so it can never be mistaken for a real itag', () => {
    const info = streamInfoFromNative('vid', progressive({ kind: 'dash', itag: 0 }));
    const keys = Object.keys(info.urls).map(Number);
    expect(keys).toEqual([-1]);
    expect(info.audio[0]!.itag).toBe(-1);
    // -1 must not look like a real audio format in the download sheet, which filters on itag > 0.
    expect(info.audio[0]!.itag).toBeLessThan(0);
  });

  it('reports the real duration so a preview is labelled as one, not played as a full track', () => {
    const clip = streamInfoFromNative('vid', progressive({ durationSec: 30 }));
    const full = streamInfoFromNative('vid', progressive({ durationSec: 213 }));

    // The declared duration must survive conversion, or the picker has no way to notice a clip.
    expect(clip.audio[0]!.durationSec).toBe(30);
    expect(full.audio[0]!.durationSec).toBe(213);

    // And the picker must call it what it is: a 30s stream against a 213s track is flagged as a
    // preview, which is what makes the UI say so instead of going quiet at 0:30.
    expect(pickAudioUrl(clip, 213)?.preview).toBe(true);
    expect(pickAudioUrl(full, 213)?.preview).toBe(false);
  });

  it('marks the profile so diagnostics can tell a native resolve from a browser one', () => {
    expect(streamInfoFromNative('vid', progressive()).profile).toBe('native:newpipe');
  });

  it('is not treated as token-gated, so it keeps the quality the extractor delivered', () => {
    // `native:*` is not in PROFILES. The default for an unknown profile is "assume gated", which makes
    // the picker choose the cheapest stream — wrong here, because the whole point of the native rung is
    // that it can serve the full file.
    const info = streamInfoFromNative(
      'vid',
      progressive({ itag: 251, kbps: 160, mime: 'audio/webm', url: 'https://example.test/hi' }),
    );
    expect(info.profile.startsWith('native:')).toBe(true);
    expect(pickAudioUrl(info, 213)?.url).toBe('https://example.test/hi');
  });

  it('carries the video-track caveat into the profile string instead of hiding it', () => {
    // The extractor could not separate audio and handed back the muxed video track. It plays, but the
    // UI must not describe it as a normal audio stream.
    const info = streamInfoFromNative('vid', progressive({ note: 'video_track', itag: 0 }));
    expect(info.profile).toBe('native:newpipe:video_track');
    expect(pickAudioUrl(info, 200)?.url).toBe('https://rr1.googlevideo.com/videoplayback?itag=140');
  });
});
