import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedWindowsStream } from "../src/routes/windowsPlayback.js";

test("Windows media proxy accepts trusted CDN hosts but rejects LAN, credentials and spoofing", () => {
  assert.equal(allowedWindowsStream("https://r1---sn.googlevideo.com/videoplayback?expire=123"), true);
  assert.equal(allowedWindowsStream("https://pipedapi.adminforge.de/proxy"), true);
  for (const url of [
    "http://r1.googlevideo.com/a", "https://googlevideo.com.attacker.test/a", "https://attacker.test/a",
    "http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "https://localhost/a",
    "https://user:password@googlevideo.com/a", "https://googlevideo.com:444/a", "file:///etc/passwd",
    "https://googlevideo.com/a#fragment",
  ]) assert.equal(allowedWindowsStream(url), false, url);
});

test("loopback is allowed only for the explicitly enabled private audio fixture", () => {
  const oldMock = process.env.RESOLVER_MOCK;
  const oldUrl = process.env.RESOLVER_URL;
  try {
    process.env.RESOLVER_MOCK = "1";
    process.env.RESOLVER_URL = "http://127.0.0.1:33771";
    assert.equal(allowedWindowsStream("http://127.0.0.1:33771/mock/audio/mock00000001"), true);
    assert.equal(allowedWindowsStream("http://127.0.0.1:33771/private"), false);
    assert.equal(allowedWindowsStream("http://127.0.0.1:33772/mock/audio/mock00000001"), false);
    process.env.RESOLVER_MOCK = "0";
    assert.equal(allowedWindowsStream("http://127.0.0.1:33771/mock/audio/mock00000001"), false);
  } finally {
    if (oldMock === undefined) delete process.env.RESOLVER_MOCK; else process.env.RESOLVER_MOCK = oldMock;
    if (oldUrl === undefined) delete process.env.RESOLVER_URL; else process.env.RESOLVER_URL = oldUrl;
  }
});
