import { test } from "node:test";
import assert from "node:assert/strict";

process.env.MOCK_UPSTREAM = "0";
process.env.LOG_LEVEL = "error";
process.env.LYRICS_BASE = "https://lyrics.invalid";
const { parseGeniusHits, matchCatalogTrack, searchLyrics } = await import("../src/services/lyricSearch.js");
const { lyricsService } = await import("../src/services/lyrics.js");

const geniusFixture = {
  response: { sections: [{ type: "lyric", hits: [{
    highlights: [{ property: "lyrics", value: "a remembered line\nnext line" }],
    result: { title: "The Song", primary_artist: { name: "The Artist" } },
  }] }] },
};
const track = (title: string, artist: string, id = "test-id") => ({
  id, source: "ytmusic" as const, external_id: id, title,
  artists: [{ name: artist }], artist_names: artist, category: "song" as const,
});

test("Genius lyric response shape yields a short snippet", () => {
  assert.deepEqual(parseGeniusHits(geniusFixture, 4), [
    { title: "The Song", artist: "The Artist", snippet: "a remembered line next line" },
  ]);
  assert.throws(() => parseGeniusHits({ response: {} }, 4), /invalid response/);
  assert.deepEqual(parseGeniusHits({ response: { sections: [] } }, 4), []);
});

test("lyric results never get an unrelated playable track", () => {
  const hit = parseGeniusHits(geniusFixture, 4)[0];
  assert.equal(matchCatalogTrack(hit, [track("The Song", "Wrong Artist")]), null);
  assert.equal(matchCatalogTrack(hit, [track("Wrong Song", "The Artist")]), null);
  assert.equal(matchCatalogTrack(hit, [track("The Song (Official Audio)", "The Artist")])?.id, "test-id");
});

test("Genius outage is an error, not a successful empty search", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try { await assert.rejects(searchLyrics("remembered line", 4), /provider unavailable/i); }
  finally { globalThis.fetch = original; }
});

test("LRCLIB distinguishes 404, failure and valid synced/plain fields", async () => {
  const original = globalThis.fetch;
  let reply = 503;
  globalThis.fetch = async () => reply === 200
    ? new Response(JSON.stringify({ id: 1, trackName: "The Song", artistName: "The Artist", plainLyrics: "a line", syncedLyrics: "[00:01.00]a line" }), { status: 200 })
    : reply === 404 && calls++ > 0
      ? new Response("[]", { status: 200 })
      : new Response("", { status: reply });
  let calls = 0;
  try {
    await assert.rejects(lyricsService.forTrack({ title: "The Song", artist_names: "The Artist" }), /provider returned 503/i);
    reply = 404;
    assert.equal(await lyricsService.forTrack({ title: "The Song", artist_names: "The Artist" }), null);
    reply = 200;
    const found = await lyricsService.forTrack({ title: "The Song", artist_names: "The Artist" });
    assert.equal(found?.plain, "a line");
    assert.equal(found?.synced?.[0].time, 1);
  } finally { globalThis.fetch = original; }
});


test("LRCLIB malformed data is an error, and unrelated fallback lyrics are rejected", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    if (count === 1) return new Response("{}", { status: 200 });
    if (count === 2) return new Response("", { status: 404 });
    return new Response(JSON.stringify([{ id: 2, trackName: "Entirely Different", artistName: "The Artist", duration: 180, syncedLyrics: "[00:01.00]wrong" }]), { status: 200 });
  };
  try {
    await assert.rejects(lyricsService.forTrack({ title: "The Song", artist_names: "The Artist" }), /invalid response/i);
    assert.equal(await lyricsService.forTrack({ title: "The Song", artist_names: "The Artist", duration_sec: 180 }), null);
  } finally { globalThis.fetch = original; }
});
