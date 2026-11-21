import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLibraryPlaylists, parsePlaylistBrowse } from '@themashup/core';

/**
 * The user's own YT Music playlists, and the songs inside them.
 *
 * This is the OuterTune behaviour the user pointed at: a playlist they create on music.youtube.com
 * appears in the app, as a "Featured" group of rows four cards wide, and it follows edits.
 *
 * Two parsers are needed and neither existed:
 *  - `parseLibraryPlaylists` — `browse(FEmusic_liked_playlists)`, the account's playlist shelf.
 *  - `parsePlaylistBrowse`    — `browse(VL<id>)`, the songs in one playlist. `playlistTracks()` was
 *    calling `parseRadioQueue` (a `next`-response parser) against a `browse` response, which returns
 *    [] for every playlist, always.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** A `musicTwoRowItemRenderer` playlist card, as the library shelf returns them. */
const card = (id: string, title: string, author = 'You') => ({
  musicTwoRowItemRenderer: {
    title: { runs: [{ text: title }] },
    subtitle: { runs: [{ text: author }, { text: ' • ' }, { text: 'Playlist' }] },
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'c.jpg', width: 120, height: 120 }] } } },
    navigationEndpoint: { browseEndpoint: { browseId: `VL${id}`, browseEndpointContextSupportedConfigs: {} } },
  },
});

/** A `musicResponsiveListItemRenderer` song row inside a playlist. */
const song = (id: string, title: string, artist: string) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: artist }, { text: ' • ' }, { text: '3:20' }] } } },
    ],
    fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:20' }] } } }],
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 's.jpg', width: 60, height: 60 }] } } },
    overlay: {
      musicItemThumbnailOverlayRenderer: {
        content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: id } } } },
      },
    },
  },
});

describe('parseLibraryPlaylists', () => {
  it('reads the playlist shelf from the library page', () => {
    const json = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            { tabRenderer: { content: {} } }, // a non-playlist tab, e.g. Songs
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [{ musicShelfRenderer: { contents: [card('PL1', 'Favorites'), card('PL2', 'Road trip')] } }],
                  },
                },
              },
            },
          ],
        },
      },
    };
    const lists = parseLibraryPlaylists(json);
    expect(lists.map((p) => p.title)).toEqual(['Favorites', 'Road trip']);
    // YouTube addresses playlists as VL + id; the app addresses them without it.
    expect(lists[0]!.id).toBe('PL1');
  });

  it('finds a shelf nested inside an itemSectionRenderer', () => {
    // The wrapper depth varies between premium and non-premium accounts — this is why ytmusicapi has
    // three separate branches for reading this page.
    const json = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      { itemSectionRenderer: { contents: [{ musicShelfRenderer: { contents: [card('PL9', 'Nested')] } }] } },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };
    expect(parseLibraryPlaylists(json).map((p) => p.title)).toEqual(['Nested']);
  });

  it('deduplicates a playlist that appears in more than one tab', () => {
    const twice = { contents: [card('PL1', 'Favorites'), card('PL1', 'Favorites')] };
    const json = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            { tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: twice }] } } } },
            { tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: twice }] } } } },
          ],
        },
      },
    };
    expect(parseLibraryPlaylists(json)).toHaveLength(1);
  });

  it('returns nothing rather than throwing on a signed-out or empty page', () => {
    for (const bad of [null, {}, [], 'nope', { contents: {} }]) {
      expect(() => parseLibraryPlaylists(bad)).not.toThrow();
      expect(parseLibraryPlaylists(bad)).toEqual([]);
    }
  });
});

describe('parsePlaylistBrowse', () => {
  it('reads the songs out of a two-column playlist page', () => {
    const json = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          secondaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  musicPlaylistShelfRenderer: {
                    contents: [song('v1', 'Song one', 'Artist A'), song('v2', 'Song two', 'Artist B')],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const tracks = parsePlaylistBrowse(json);
    expect(tracks.map((t) => t.id)).toEqual(['v1', 'v2']);
    expect(tracks[0]!.title).toBe('Song one');
    expect(tracks[0]!.artist).toBe('Artist A');
  });

  it('falls back to the single-column shape', () => {
    const json = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            { tabRenderer: { content: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: [song('x1', 'X', 'Y')] } }] } } } },
          ],
        },
      },
    };
    expect(parsePlaylistBrowse(json).map((t) => t.id)).toEqual(['x1']);
  });

  it('returns nothing rather than throwing on a radio/next response', () => {
    // The old code fed a `next` response to a `browse` parser and vice versa. Both must be safe.
    expect(parsePlaylistBrowse({ contents: { singleColumnMusicWatchNextResultsRenderer: {} } })).toEqual([]);
  });
});

describe('the service and the home feed are wired to them', () => {
  const service = read('lib/service.ts');
  const hook = read('hooks/useHomeFeed.ts');

  it('looks up playlists by their VL-prefixed browse id', () => {
    // InnerTube rejects the bare id.
    expect(service).toMatch(/playlistId\.startsWith\('VL'\) \? playlistId : `VL\$\{playlistId\}`/);
  });

  it('parses a playlist with the browse parser, not the radio one', () => {
    const fn = service.slice(service.indexOf('async playlistTracks'));
    const body = fn.slice(0, fn.indexOf('async libraryPlaylists'));
    // Strip comments: the doc explains what the old code did, which mentions the wrong parser.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('parsePlaylistBrowse');
    expect(code).not.toContain('parseRadioQueue');
  });

  it('asks the library for playlists, not the home feed', () => {
    // A playlist created on music.youtube.com is on the home feed of neither app.
    expect(service).toContain('FEmusic_liked_playlists');
  });

  it('puts the user’s own groups above the home feed', () => {
    /*
     * Order is now pinned playlist, then library "Featured", then the home feed's own shelves — the
     * things the user asked for by name come first, YouTube's generic rows after.
     */
    expect(hook).toMatch(/\[\.\.\.pinnedGroup, \.\.\.featured, \.\.\.normalize\(feed\)\]/);
    expect(hook).toContain("'Featured'");
  });

  it('chunks the group four to a row', () => {
    expect(hook).toMatch(/FEATURED_PER_ROW = 4/);
    expect(hook).toMatch(/i \+= FEATURED_PER_ROW/);
  });

  it('refreshes on an interval and when the app becomes visible again', () => {
    /*
     * The requirement is that the home screen follows edits made in YouTube. A one-shot fetch cannot:
     * the edit happens in another app. Returning to the app is the moment it has to be right.
     */
    expect(hook).toContain('LIBRARY_REFRESH_MS');
    expect(hook).toContain('visibilitychange');
  });

  it('replaces only the Featured group, so the page does not reshuffle under the user', () => {
    expect(hook).toContain('s.featured');
  });
});
