import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const host = path.join(root, 'windows/services/host.mjs');
const webroot = await mkdtemp(path.join(os.tmpdir(), 'themashup-search-webroot-'));
await writeFile(path.join(webroot, 'index.html'), '<h1>fixture preview</h1>');
const env = { ...process.env, RESOLVER_MOCK: '1', MOCK_UPSTREAM: '1' };

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
  assert.equal((await fetch(`${base}/api/downloads`)).status, 404);
  assert.equal((await fetch(`${base}/api/search?q=x`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 404);
  child.stdin.end();
  assert.equal(await waitExit(child), 0, 'closing desktop parent pipe must stop the host');
  child = undefined;
  const failed = start([], { THEMASHUP_PYTHON: path.join(webroot, 'missing-python') });
  await assert.rejects(failed.ready, /exited|ENOENT/);
  assert.notEqual(await waitExit(failed.child), 0, 'missing runtime must be a startup error, not fake empty results');
  console.log('PASS: same-origin fixture integration, route restrictions, lifecycle and startup errors.');
  console.log('Fixture test only: no live provider or Windows runtime was exercised.');
} finally {
  child?.kill('SIGTERM');
  await rm(webroot, { recursive: true, force: true });
}
