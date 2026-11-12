import { describe, expect, it } from 'vitest';
import { parseHomeFeed } from '@themashup/core';

/**
 * The YT Music home feed parser.
 *
 * This is the piece that decides whether Home shows the rows the user actually sees on
 * music.youtube.com. It is fixture-tested rather than network-tested because the payload shape is the
 * only thing that can be wrong in a way that survives a build: a renamed renderer or a shelf title in
 * a different place would silently produce an empty home screen, which looks identical to "this
 * account has no feed".
 */

/** `musicResponsiveListItemRenderer` — the workhorse row, used inside carousels and shelves. */
const row = (id: string, title: string, artist: string, dur = '3:45') => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: id },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: artist }, { text: ' • ' }, { text: dur }] },
        },
      },
    ],
    thumbnail: {
      musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'cover.jpg', width: 60, height: 60 }] } },
    },
  },
});

/** `musicTwoRowItemRenderer` — the card row that only appears on the home page. */
const twoRow = (id: string, title: string, subtitle: string) => ({
  musicTwoRowItemRenderer: {
    title: { runs: [{ text: title }] },
    subtitle: { runs: [{ text: subtitle }] },
    thumbnail: {
      musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'card.jpg', width: 120, height: 120 }] } },
    },
    navigationEndpoint: { watchEndpoint: { videoId: id } },
  },
});

/** A playlist card: a two-row item with a browse endpoint and no video id. Must not become a track. */
const playlistCard = (title: string) => ({
  musicTwoRowItemRenderer: {
    title: { runs: [{ text: title }] },
    subtitle: { runs: [{ text: 'Playlist' }] },
    navigationEndpoint: { browseEndpoint: { browseId: 'VLPL123' } },
  },
});

const carousel = (title: string, items: unknown[]) => ({
  musicCarouselShelfRenderer: {
    header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: title }] } } },
    contents: items,
  },
});

const feedOf = (sections: unknown[]) => ({
  contents: {
    singleColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: { sectionListRenderer: { contents: sections } },
          },
        },
      ],
    },
  },
});

describe('parseHomeFeed', () => {
  it('reads carousel and vertical shelves, in YouTube order', () => {
    const { shelves } = parseHomeFeed(
      feedOf([
        carousel('Quick picks', [row('a1', 'Song A', 'Artist A'), row('a2', 'Song B', 'Artist B')]),
        carousel('Listen again', [twoRow('b1', 'Song C', 'Artist C • 2:30')]),
        { musicShelfRenderer: { title: { runs: [{ text: 'Mixed for you' }] }, contents: [row('c1', 'Song D', 'Artist D')] } },
      ]),
    );

    expect(shelves.map((s) => s.title)).toEqual(['Quick picks', 'Listen again', 'Mixed for you']);
    expect(shelves[0]!.tracks).toHaveLength(2);
    expect(shelves[0]!.tracks[0]).toMatchObject({ id: 'a1', title: 'Song A', artist: 'Artist A' });
  });

  it('passes shelf names through verbatim instead of mapping them onto a fixed set', () => {
    // YouTube renames these constantly. A whitelist would silently empty the page.
    const { shelves } = parseHomeFeed(feedOf([carousel('Because you listened to Atif Aslam', [row('x', 'X', 'Y')])]));
    expect(shelves[0]!.title).toBe('Because you listened to Atif Aslam');
  });

  it('parses the two-row card shape, which has no flexColumns', () => {
    const { shelves } = parseHomeFeed(feedOf([carousel('Replay', [twoRow('b1', 'Song C', 'Artist C • 2:30')])]));
    const track = shelves[0]!.tracks[0]!;
    expect(track.title).toBe('Song C');
    expect(track.artist).toBe('Artist C');
    expect(track.durationSec).toBe(150);
  });

  it('drops playlist and album cards rather than inventing a song for them', () => {
    // A card with no video id cannot be played. Turning it into its first track would make the queue
    // disagree with what the user tapped.
    const { shelves } = parseHomeFeed(feedOf([carousel('Mixed for you', [playlistCard('Wedding songs'), row('r1', 'Real', 'Song')])]));
    expect(shelves).toHaveLength(1);
    expect(shelves[0]!.tracks.map((t) => t.id)).toEqual(['r1']);
  });

  it('skips a shelf whose tracks are all unplayable rather than showing an empty row', () => {
    const { shelves } = parseHomeFeed(feedOf([carousel('Just playlists', [playlistCard('A'), playlistCard('B')])]));
    expect(shelves).toEqual([]);
  });

  it('never throws, whatever it is handed', () => {
    // The zero-crash contract: a bad payload loses a screen, never the app.
    for (const bad of [null, undefined, {}, [], 'nonsense', 42, { contents: {} }]) {
      expect(() => parseHomeFeed(bad)).not.toThrow();
      expect(parseHomeFeed(bad).shelves).toEqual([]);
    }
  });
});
