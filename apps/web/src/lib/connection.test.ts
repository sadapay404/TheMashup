/**
 * Connection manager helpers (Phase 8 fix cycle) — URL normalization and the
 * reachability probe, with fetch stubbed. Store behavior that needs native
 * plugins is exercised on-device (docs/MOBILE.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeServerUrl, probeServer, SERVER_KEY } from "./connection";

test("normalizeServerUrl: hosts, ports, schemes, junk", () => {
  assert.equal(normalizeServerUrl("192.168.1.20"), "http://192.168.1.20:4000");
  assert.equal(normalizeServerUrl("192.168.1.20:4000"), "http://192.168.1.20:4000");
  assert.equal(normalizeServerUrl("http://192.168.1.20:4000/"), "http://192.168.1.20:4000");
  assert.equal(normalizeServerUrl("  pc.local  "), "http://pc.local:4000");
  // Default https port is normalized away by the URL API — that's fine.
  assert.equal(normalizeServerUrl("https://music.example.test"), "https://music.example.test");
  assert.equal(normalizeServerUrl("https://music.example.test:8443/"), "https://music.example.test:8443");
  assert.equal(normalizeServerUrl(""), null);
  assert.equal(normalizeServerUrl("   "), null);
  assert.equal(normalizeServerUrl("http://"), null);
  assert.equal(normalizeServerUrl("not a host"), null);
});

test("probeServer: true on 200, false on non-ok and network errors", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as typeof fetch;
    assert.equal(await probeServer("http://gw.local:4000"), true);

    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal(await probeServer("http://gw.local:4000"), false);

    globalThis.fetch = (async () => {
      throw new TypeError("connection refused");
    }) as typeof fetch;
    assert.equal(await probeServer("http://gw.local:4000"), false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("storage key stays stable (device remembers its gateway)", () => {
  assert.equal(SERVER_KEY, "themashup.server");
});
