/**
 * The transport chain's failure classification.
 *
 * The bug these tests exist to prevent: every failed request counted against the *route*, including
 * HTTP 400 and 403 responses that YouTube had successfully delivered. Four of those trip the breaker
 * for two minutes, after which the app refuses to send anything and reports "No route available" —
 * on a phone whose network is working perfectly. That is how a reachable host turns into an app that
 * cannot play, and it is indistinguishable from a genuine outage unless something tests it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportChain, type Relay } from '@themashup/core';

/** A relay that is guaranteed never to be reached in these tests. */
const NO_RELAYS: Relay[] = [];

const okBody = { responseContext: { visitorData: 'Cgtabc' }, ok: true };

const respond = (status: number, json: unknown = okBody) =>
  new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });



const request = {
  url: 'https://music.youtube.com/youtubei/v1/player?key=x',
  method: 'POST' as const,
  headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '67' },
  body: { videoId: 'v' },
};

describe('transport failure classification', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  /** A `Response` body is single-use, so every mocked call builds a fresh one. */
  const respondWith = (status: number, json: unknown = okBody) =>
    fetchMock.mockImplementation(async () => respond(status, json));

  it('keeps the route alive when YouTube answers 403', async () => {
    // A 403 is a completed round trip: DNS, TCP, TLS and the request all worked, and YouTube chose
    // to refuse. The route is healthy. Counting this as a route failure is the outage we shipped.
    respondWith(403, { error: 'forbidden' });
    const chain = new TransportChain(NO_RELAYS, false);

    for (let i = 0; i < 6; i++) {
      await expect(chain.fetch(request)).rejects.toMatchObject({ k: 'Upstream', status: 403 });
    }

    // Six failures later, a good request must still go out. If the breaker had tripped, this would
    // reject with "No route available" without ever calling fetch.
    respondWith(200);
    await expect(chain.fetch(request)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('keeps the route alive when YouTube answers 400', async () => {
    respondWith(400, { error: 'invalid argument' });
    const chain = new TransportChain(NO_RELAYS, false);
    for (let i = 0; i < 6; i++) {
      await expect(chain.fetch(request)).rejects.toMatchObject({ k: 'Upstream' });
    }
    respondWith(200);
    await expect(chain.fetch(request)).resolves.toBeDefined();
  });

  it('does back off the route when the server itself is failing', async () => {
    // 5xx is a genuine route/server problem: worth a cooldown rather than hammering it.
    respondWith(503, {});
    const chain = new TransportChain(NO_RELAYS, false);
    const errors: unknown[] = [];
    for (let i = 0; i < 8; i++) {
      try {
        await chain.fetch(request);
      } catch (e) {
        errors.push(e);
      }
    }
    const last = errors.at(-1) as { k?: string; cause?: string };
    expect(last?.k).toBe('Network');
    expect(last?.cause).toBe('offline');
  });

  it('treats a network rejection as a route failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const chain = new TransportChain(NO_RELAYS, false);
    for (let i = 0; i < 8; i++) {
      await expect(chain.fetch(request)).rejects.toBeDefined();
    }
    const last = await chain.fetch(request).catch((e) => e);
    expect(last.k).toBe('Network');
  });
});
