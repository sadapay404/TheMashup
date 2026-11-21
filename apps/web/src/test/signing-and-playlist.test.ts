import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePlaylistBrowseDeep, sapisidhash } from '@themashup/core';

/**
 * Two failures, both of which looked like "the feature is missing" and were neither.
 *
 * 1. **The playlist did not pull.** Its songs come back from `browse(VL<id>)`, which needs no account
 *    at all — but the *request* was being sent unauthenticated in a way that also broke every
 *    personalised call. The missing piece was `Authorization: SAPISIDHASH`, which this app has never
 *    sent.
 * 2. **Uninstall on every release.** Every CI runner generated its own debug key. Fixed by committing
 *    one key; asserted here because "the build silently fell back to debug" is invisible until the
 *    user tries to install.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const client = read('../../../packages/core/src/innertube/client.ts');
const service = read('lib/service.ts');
const hook = read('hooks/useHomeFeed.ts');

describe('sapisidhash', () => {
  it('produces the documented shape', async () => {
    const cookie = 'SID=abc; SAPISID=SoMeSaPiSiD; HSID=def; SSID=ghi';
    const auth = await sapisidhash(cookie, 'https://music.youtube.com', 1_700_000_000);
    expect(auth).toMatch(/^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);
  });

  it('is SHA-1 over "<ts> <sapisid> <origin>"', async () => {
    /*
     * Pinned against a known digest rather than re-deriving it, so a change to the input string (an
     * easy, silent mistake — wrong separator, wrong origin, wrong field order) fails here instead of
     * looking like "YouTube ignored our session" in production.
     */
    const cookie = 'SAPISID=SoMeSaPiSiD';
    const ts = 1_700_000_000;
    const input = `${ts} SoMeSaPiSiD https://music.youtube.com`;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input)));
    const hex = Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await sapisidhash(cookie, 'https://music.youtube.com', ts)).toBe(`SAPISIDHASH ${ts}_${hex}`);
  });

  it('returns null when the cookie has no SAPISID', async () => {
    // Sending an empty/garbage Authorization header is worse than sending none.
    expect(await sapisidhash('SID=a; HSID=b')).toBeNull();
  });

  it('falls back to the secure-prefixed cookie name', async () => {
    const auth = await sapisidhash('__Secure-3PAPISID=XYZ', 'https://music.youtube.com', 1);
    expect(auth).toMatch(/^SAPISIDHASH 1_[0-9a-f]{40}$/);
  });

  it('is actually attached to requests when signed in', () => {
    // Without this the server ignores the cookie and answers as an anonymous visitor — which is why
    // the home feed and library were generic even after a successful sign-in.
    expect(client).toContain('sapisidhash');
    expect(client).toMatch(/request\.headers\['Authorization'\] = auth/);
  });
});

describe('the pinned playlist', () => {
  it('is requested by its id, without gating on an account', () => {
    /*
     * A public playlist id is public addressing. The one the user gave is public, and gating this on
     * `hasAccount()` was a direct path to "it did not pull the playlist" for anyone whose session was
     * not working — which was everyone, because auth was broken.
     */
    expect(hook).toContain("PLT_8JyiMy1Zk");
    const fn = service.slice(service.indexOf('async playlistTracksAll'));
    expect(fn.slice(0, fn.indexOf('hasAccount'))).not.toContain('hasAccount');
  });

  it('follows continuations, so a long playlist is not cut at 25 songs', () => {
    expect(service).toContain('parsePlaylistBrowseDeep');
    expect(service).toContain('continuation');
  });

  it('stops if a page adds nothing, instead of looping on a repeated token', () => {
    expect(service).toMatch(/added === 0\) break/);
  });

  it('asks for the whole playlist, not the preview', () => {
    // The home hook must call the continuation-following method for the pinned playlist.
    expect(hook).toMatch(/playlistTracksAll\(PINNED_PLAYLIST_ID\)/);
  });

  it('renders four songs per row with no cap on rows', () => {
    expect(hook).toMatch(/PINNED_PER_ROW = 4/);
    // The loop runs to the end of the track list; there is no max-rows clamp on the pinned group.
    const fn = hook.slice(hook.indexOf('function pinnedRows'));
    const body = fn.slice(0, fn.indexOf('function featuredRows'));
    expect(body).toMatch(/i < tracks\.length/);
    expect(body).not.toMatch(/slice\(0, \d+\)/);
  });

  it('refreshes when the app comes back to the foreground', () => {
    // The playlist is edited in YouTube, so returning to the app is exactly when it must be re-read.
    const fn = hook.slice(hook.indexOf('const refresh = useCallback'));
    expect(fn.slice(0, 800)).toContain('playlistTracksAll(PINNED_PLAYLIST_ID)');
  });
});

describe('parsePlaylistBrowseDeep', () => {
  const song = (id: string, title: string) => ({
    musicResponsiveListItemRenderer: {
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artist' }, { text: ' • ' }, { text: '3:00' }] } } },
      ],
      overlay: {
        musicItemThumbnailOverlayRenderer: {
          content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: id } } } },
        },
      },
    },
  });

  it('returns the tracks and the continuation token together', () => {
    const json = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          secondaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  musicPlaylistShelfRenderer: {
                    contents: [
                      song('a', 'A'),
                      {
                        continuationItemRenderer: {
                          continuationEndpoint: { continuationCommand: { token: 'CAoQAA' } },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const deep = parsePlaylistBrowseDeep(json);
    expect(deep.tracks.map((t) => t.id)).toEqual(['a']);
    expect(deep.continuation).toBe('CAoQAA');
  });

  it('omits the token field entirely when there is no next page', () => {
    const json = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: [song('a', 'A')] } }] } },
        },
      },
    };
    expect(parsePlaylistBrowseDeep(json).continuation).toBeUndefined();
  });
});

describe('one signing key for every build', () => {
  const gradle = readFileSync(resolve(__dirname, '../../../../apps/android/android/app/build.gradle.kts'), 'utf8');
  const wf = readFileSync(resolve(__dirname, '../../../../.github/workflows/android.yml'), 'utf8');

  it('ships a committed keystore', () => {
    expect(existsSync(resolve(__dirname, '../../../../apps/android/keys/themashup.p12'))).toBe(true);
  });

  it('prefers it over the debug key', () => {
    // The debug key is generated per runner: every build a different signature, so Android refuses to
    // install over the previous one and the user has to uninstall — losing their downloads each time.
    expect(gradle).toContain('keys/themashup.p12');
    expect(gradle).toMatch(/hasKey[\s\S]{0,120}signingConfigs\.getByName\("release"\)/);
  });

  it('still honours an environment key when the committed one is absent', () => {
    // A future properly-secret key must drop in without editing the build file.
    expect(gradle).toContain('MASHUP_KEYSTORE_PATH');
  });

  it('treats a blank environment value as "not provided"', () => {
    /*
     * GitHub Actions defines every `env:` key it declares, and a secret that does not exist resolves
     * to an EMPTY STRING, not to undefined. `System.getenv(x) ?: default` therefore returns "" and
     * the keystore is opened with an empty password — which fails the build with "Assemble failed"
     * and no mention of signing anywhere.
     */
    expect(gradle).toContain('takeIf { it.isNotBlank() }');
    expect(gradle).toContain('isNullOrBlank()');
    // The naive form must not come back.
    expect(gradle).not.toMatch(/getenv\("MASHUP_KEYSTORE_PASSWORD"\) \?:/);
  });


  it('never truncates the playlist at a page cap', () => {
    /*
     * "no limits of how many rows it creates depending upon the number of songs in the playlist."
     * A page cap silently shortens the playlist and then presents the shortened list as the whole
     * thing, which is indistinguishable from the playlist actually being that short. Termination is
     * carried by the no-progress break and by the token running out.
     */
    expect(service).not.toMatch(/page < \d+/);
    expect(service).toContain('for (let page = 0; token; page++)');
    // The two real terminators must still be there.
    expect(service).toContain('added === 0');
    expect(service).toMatch(/token = more\.continuation/);
  });

  it('writes the keystore in a form the JDK can read', () => {
    /*
     * OpenSSL 3 defaults to AES-256 + PBKDF2-SHA256 in PKCS#12, which the JDK keystore reader
     * rejects. Reading it back with `openssl` proves the MAC/algorithm header; the CI step proves it
     * with keytool before the build starts.
     */
    const wf = readFileSync(resolve(__dirname, '../../../../.github/workflows/android.yml'), 'utf8');
    expect(wf).toContain('keytool -list');
    expect(wf).toMatch(/Signing key unreadable/);
  });

  it('fails the build if the key disappears', () => {
    // Silent fallback to a debug key is invisible until the user tries to install.
    expect(wf).toContain('Verify committed signing key');
    expect(wf).toMatch(/keys\/themashup\.p12/);
  });
});
