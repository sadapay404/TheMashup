import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const host = path.join(root, 'windows/services/host.mjs');
const webroot = await mkdtemp(path.join(os.tmpdir(), 'themashup-search-webroot-'));
await writeFile(path.join(webroot, 'index.html'), '<h1>fixture preview</h1>');
const env = { ...process.env, RESOLVER_MOCK: '1', MOCK_UPSTREAM: '1', THEMASHUP_FIXTURE_VIDEO: '1' };

function start(args, moreEnv = {}) {
  const child = spawn(process.execPath, [host, ...args], { cwd: root, env: { ...env, ...moreEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const ready = new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error(`host startup timed out: ${errors}`)), 30_000);
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/THEMASHUP_HOST_PORT=(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { if (!buffer.includes('THEMASHUP_HOST_PORT=')) { clearTimeout(timeout); reject(new Error(`host exited ${code}: ${errors}`)); } });
  });
  return { child, ready };
}
function requestWithHost(port, host, requestPath = '/api/playback/session') {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: requestPath, headers: { Host: host } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}
function waitExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('host did not exit')), 5_000);
    child.once('exit', code => { clearTimeout(timeout); resolve(code); });
  });
}

let child;
try {
  const running = start(['--preview', '--webroot', webroot, '--bind', '127.0.0.1', '--port', '0'], { THEMASHUP_PARENT_PIPE: '1' });
  child = running.child;
  const port = await running.ready;
  const base = `http://127.0.0.1:${port}`;
  assert.match(await (await fetch(`${base}/`)).text(), /fixture preview/);
  const search = await (await fetch(`${base}/api/search?q=midnight`)).json();
  assert.equal(search.tracks[0].title, 'Midnight Mirage');
  assert.ok(search.warnings.includes('mock_mode'));
  const suggestions = await (await fetch(`${base}/api/search/suggest?q=mid`)).json();
  assert.ok(suggestions.suggestions.includes('Midnight Mirage'));
  const lyric = await (await fetch(`${base}/api/search/lyrics?q=city%20hums%20in%20ultraviolet`)).json();
  assert.equal(lyric.source, 'mock');
  assert.equal(lyric.hits[0].track.id, 'mock00000001');
  const lines = await (await fetch(`${base}/api/lyrics/by-metadata?title=Midnight%20Mirage&artist=Nova%20Arcade`)).json();
  assert.equal(lines.provider, 'mock');
  assert.ok(lines.synced.length > 0);
  assert.equal((await fetch(`${base}/api/lyrics/by-metadata?title=Unrelated&artist=Nobody`)).status, 404);
  const session = (await (await fetch(`${base}/api/playback/session`)).json()).session;
  assert.match(session, /^[A-Za-z0-9_-]{32}$/);
  const resolve = (body, headers = {}) => fetch(`${base}/api/playback/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await resolve({ video_id: 'mock00000001' })).status, 403, 'cross-origin pages cannot resolve without a session token');
  assert.equal((await resolve({ video_id: 'mock00000001' }, { 'X-TheMashup-Session': session, 'Content-Type': 'text/plain' })).status, 403);
  const resolved = await (await resolve({ video_id: 'mock00000001', mode: 'audio' }, { 'X-TheMashup-Session': session })).json();
  assert.ok(resolved.candidates.length > 1);
  assert.equal(resolved.candidates[0].source, 'ytdlp');
  assert.ok(resolved.candidates.every(c => /^\/api\/playback\/stream\/[A-Za-z0-9_-]{24}$/.test(c.play_url)));
  assert.ok(!JSON.stringify(resolved).includes('127.0.0.1'), 'private upstream URLs must not reach the browser');
  assert.ok(!JSON.stringify(resolved).includes('http_headers'), 'provider headers must not reach the browser');
  const range = await fetch(`${base}${resolved.candidates[0].play_url}`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(range.status, 206);
  assert.match(range.headers.get('content-range'), /^bytes 0-99\/\d+$/);
  assert.equal(range.headers.get('accept-ranges'), 'bytes');
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(`${base}${resolved.candidates[0].play_url}`, { headers: { Range: 'bytes=0-1,4-5' } })).status, 400);
  const dead = resolved.candidates.at(-1).play_url;
  assert.equal((await fetch(`${base}${dead}`)).status, 410, 'dead candidates must fail over, not hang');
  assert.equal((await fetch(`${base}/api/playback/stream/AAAAAAAAAAAAAAAAAAAAAAAA`)).status, 410);
  const videoResolution = await (await resolve({ video_id: 'mock00000001', mode: 'video' }, { 'X-TheMashup-Session': session })).json();
  assert.equal(videoResolution.candidates.length, 1);
  assert.equal(videoResolution.candidates[0].has_video, true);
  const video = await fetch(`${base}${videoResolution.candidates[0].play_url}`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(video.status, 206);
  assert.equal(video.headers.get('content-type'), 'video/webm');
  assert.deepEqual(Array.from(new Uint8Array(await video.arrayBuffer()).slice(0, 4)), [0x1a, 0x45, 0xdf, 0xa3]);
  assert.equal((await resolve({ video_id: '../private' }, { 'X-TheMashup-Session': session })).status, 400);
  const oversized = await fetch(`${base}/api/playback/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TheMashup-Session': session },
    body: JSON.stringify({ video_id: 'x'.repeat(3000) }),
  });
  assert.equal(oversized.status, 413, 'oversized bodies must be rejected without killing the host');
  // Abort mid-body. The server must catch the request error rather than crash
  // its async handler; the next valid request proves the process is still alive.
  await new Promise(resolveAbort => {
    const request = http.request(`${base}/api/playback/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TheMashup-Session': session, 'Content-Length': '500' },
    });
    request.on('error', () => {});
    request.on('socket', socket => socket.once('connect', () => {
      request.write('{"video_id":');
      setTimeout(() => { request.destroy(); resolveAbort(); }, 25);
    }));
  });
  assert.equal((await fetch(`${base}/api/playback/session`)).status, 200);
  assert.equal((await fetch(`${base}/api/downloads`)).status, 404);
  assert.equal((await fetch(`${base}/api/search?q=x`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 404);
  child.stdin.end();
  assert.equal(await waitExit(child), 0, 'closing desktop parent pipe must stop the host');
  child = undefined;
  const desktop = start([], { THEMASHUP_PARENT_PIPE: '1' });
  child = desktop.child;
  const desktopPort = await desktop.ready;
  const desktopBase = `http://127.0.0.1:${desktopPort}`;
  assert.equal((await fetch(`${desktopBase}/api/playback/session`)).status, 200);
  assert.equal(await requestWithHost(desktopPort, `attacker.example:${desktopPort}`), 403,
    'desktop Host validation must reject DNS-rebinding hostnames');
  assert.equal(await requestWithHost(desktopPort, `localhost:${desktopPort}`, '/api/search?q=midnight'), 403);
  const noCors = await fetch(`${desktopBase}/api/playback/session`, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(noCors.headers.get('access-control-allow-origin'), null);
  child.stdin.end();
  assert.equal(await waitExit(child), 0);
  child = undefined;
  const failed = start([], { THEMASHUP_PYTHON: path.join(webroot, 'missing-python') });
  await assert.rejects(failed.ready, /exited|ENOENT/);
  assert.notEqual(await waitExit(failed.child), 0, 'missing runtime must be a startup error, not fake empty results');
  console.log('PASS: fixture playback resolve, range proxy, security, lifecycle and startup errors.');
  console.log('Fixture test only: no live provider or Windows runtime was exercised.');
} finally {
  child?.kill('SIGTERM');
  await rm(webroot, { recursive: true, force: true });
}
