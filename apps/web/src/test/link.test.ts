import { describe, expect, it } from 'vitest';
import { parseLink } from '@/lib/link';

/**
 * Link parsing, tested against the shapes people actually paste — including the app's Share sheet,
 * which appends `?si=` tracking and often drops the scheme.
 */
describe('parseLink', () => {
  const video = 'dQw4w9WgXcQ';

  it.each([
    `https://www.youtube.com/watch?v=${video}`,
    `https://youtube.com/watch?v=${video}&t=42s`,
    `https://music.youtube.com/watch?v=${video}&list=RDAMVM`,
    `https://m.youtube.com/watch?v=${video}`,
    `https://youtu.be/${video}`,
    `https://youtu.be/${video}?si=abc123`,
    `https://www.youtube.com/shorts/${video}`,
    `https://www.youtube.com/embed/${video}`,
    `https://www.youtube.com/live/${video}`,
    `youtube.com/watch?v=${video}`,
    `  https://youtu.be/${video}  `,
    video,
  ])('reads a video id from %s', (input) => {
    const out = parseLink(input);
    // A `list=` link resolves as a playlist carrying the video id, which is the useful behaviour.
    if (out?.kind === 'playlist') {
      expect(out.videoId).toBe(video);
    } else {
      expect(out).toEqual({ kind: 'video', videoId: video });
    }
  });

  it('reads a playlist link', () => {
    expect(parseLink('https://www.youtube.com/playlist?list=PLabc123456789')).toEqual({
      kind: 'playlist',
      playlistId: 'PLabc123456789',
    });
  });

  it('prefers the playlist when both ids are present', () => {
    const out = parseLink(`https://www.youtube.com/watch?v=${video}&list=PLabc123456789`);
    expect(out).toEqual({ kind: 'playlist', playlistId: 'PLabc123456789', videoId: video });
  });

  it('rejects a non-YouTube host by name rather than guessing', () => {
    const out = parseLink('https://open.spotify.com/track/abc');
    expect(out?.kind).toBe('unsupported');
    if (out?.kind === 'unsupported') expect(out.reason).toContain('open.spotify.com');
  });

  it('reports an id-less playlist instead of failing silently', () => {
    expect(parseLink('https://www.youtube.com/playlist')?.kind).toBe('unsupported');
  });

  it('returns null only for genuinely empty input', () => {
    expect(parseLink('')).toBeNull();
    expect(parseLink('   ')).toBeNull();
  });

  it('does not treat arbitrary text as a link', () => {
    expect(parseLink('hello world')?.kind).toBe('unsupported');
  });
});
