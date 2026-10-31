#!/usr/bin/env node
// Development host for the Avalonia browser/desktop heads. Python and Express
// bind to loopback on OS-assigned ports; only explicitly allowed routes are proxied.
// Final Windows distribution must bundle these runtimes/dependencies; this
// development script does not produce an EXE or perform that packaging.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const webrootArg = value('--webroot', '');
const port = Number(value('--port', preview ? '8080' : '0'));
const bind = preview ? value('--bind', '0.0.0.0') : '127.0.0.1';
if (!Number.isInteger(port) || port < 0 || port > 65535 || (preview && !webrootArg)) {
  console.error('Usage: node windows/services/host.mjs [--preview --webroot PATH [--bind HOST] [--port PORT]]');
  process.exit(2);
}
const webroot = preview ? await realpath(webrootArg) : null;
const python = process.env.THEMASHUP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const tsx = path.join(repo, 'apps/api/node_modules/tsx/dist/cli.mjs');
const children = [];
let server;
let closing = false;
const sessionToken = randomBytes(24).toString('base64url');

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  server?.close();
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  // Give children a moment to release their ports, then exit even if a peer
  // refuses to stop. Desktop also kills the full process tree on normal exit.
  setTimeout(() => process.exit(code), 500).unref();
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
if (process.env.THEMASHUP_PARENT_PIPE === '1') {
  process.stdin.resume();
  process.stdin.on('end', () => shutdown());
}

function start(executable, argv, options, marker) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.push(child);
    child.stderr.pipe(process.stderr);
    let data = '';
    let ready = false;
    const timer = setTimeout(() => reject(new Error(`${marker} startup timed out`)), 25_000);
    child.stdout.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 65_536) return reject(new Error(`${marker} emitted too much startup output`));
      const match = data.match(new RegExp(`(?:^|\\n)${marker}=(\\d+)(?:\\r?\\n|$)`));
      if (match && !ready) {
        ready = true;
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (!ready) reject(new Error(`${marker} exited before startup (${code})`));
      else if (!closing) { console.error(`${marker} stopped unexpectedly`); shutdown(1); }
    });
  });
}

const allowedApi = new Set(['/api/search', '/api/search/suggest', '/api/search/lyrics', '/api/lyrics/by-metadata', '/api/downloads']);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
function error(res, status) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(status === 404 ? 'Not found' : status === 405 ? 'Method not allowed' : status === 403 ? 'Forbidden' : status === 413 ? 'Request too large' : status === 400 ? 'Bad request' : 'Service unavailable');
}

try {
  const resolverPort = await start(python, [path.join(here, 'resolver_entry.py')], {
    cwd: path.join(repo, 'services/resolver'), env: { ...process.env, PYTHONUNBUFFERED: '1',
      PYTHONPATH: path.join(repo, 'services/resolver') },
  }, 'THEMASHUP_RESOLVER_PORT');
  const gatewayPort = await start(process.execPath, [tsx, path.join(repo, 'apps/api/src/windowsSearchServer.ts')], {
    cwd: repo,
    env: { ...process.env, RESOLVER_URL: `http://127.0.0.1:${resolverPort}`,
      CORS_ORIGIN: 'http://localhost.invalid', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
      ALLOW_DEV_AUTH: '0', LOG_LEVEL: 'error' },
  }, 'THEMASHUP_GATEWAY_PORT');

  async function handleRequest(req, res) {
    let url;
    try { url = new URL(req.url || '/', 'http://local.invalid'); }
    catch { return error(res, 404); }
    // A desktop loopback server must reject DNS-rebinding hostnames. Preview
    // uses the caller's proxied host and is protected by the session token.
    if (!preview) {
      const address = server.address();
      if (!address || typeof address === 'string' || req.headers.host !== `127.0.0.1:${address.port}`)
        return error(res, 403);
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/playback/session' && req.method === 'GET' && !url.search) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ session: sessionToken }));
        return;
      }
      const resolving = url.pathname === '/api/playback/resolve' && req.method === 'POST' && !url.search;
      const streaming = /^\/api\/playback\/stream\/[A-Za-z0-9_-]{24}$/.test(url.pathname) &&
        ['GET', 'HEAD'].includes(req.method || '') && !url.search;
      const downloadStart = url.pathname === '/api/downloads/start' && req.method === 'POST' && !url.search;
      // The file route carries a short-lived ?token= query, so it must forward
      // the query string; the gateway validates the token before serving bytes.
      const downloadFile = /^\/api\/downloads\/[A-Za-z0-9_-]{10,64}\/file$/.test(url.pathname) &&
        ['GET', 'HEAD'].includes(req.method || '');
      const downloadList = url.pathname === '/api/downloads' && req.method === 'GET' && !url.search;
      const downloadItem = /^\/api\/downloads\/[A-Za-z0-9_-]{10,64}$/.test(url.pathname) &&
        ['GET', 'DELETE'].includes(req.method || '') && !url.search;
      if (downloadStart) {
        const token = req.headers['x-themashup-session'];
        if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(sessionToken) ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(sessionToken))) return error(res, 403);
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return error(res, 403);
      }
      if (downloadStart || downloadFile || downloadList || downloadItem) {
        const headers = downloadStart ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' };
        if (!downloadStart) { forward(null, headers); return; }
        let length = 0;
        let tooLarge = false;
        const chunks = [];
        req.on('data', chunk => {
          if (tooLarge) return;
          length += chunk.length;
          if (length > 204_800) {
            tooLarge = true;
            chunks.length = 0;
            if (!res.destroyed) error(res, 413);
          } else chunks.push(chunk);
        });
        req.once('error', () => { if (!res.destroyed) error(res, 400); });
        req.once('end', () => {
          if (!tooLarge && !res.destroyed && !req.aborted) forward(Buffer.concat(chunks), headers);
        });
        return;
      }
      if (resolving) {
        const token = req.headers['x-themashup-session'];
        if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(sessionToken) ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(sessionToken))) return error(res, 403);
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return error(res, 403);
      } else if (!streaming) {
        if (!allowedApi.has(url.pathname)) return error(res, 404);
        if (req.method !== 'GET') return error(res, 405);
      }
      const headers = resolving ? { 'Content-Type': 'application/json' } :
        streaming ? (typeof req.headers.range === 'string' ? { Range: req.headers.range } : {}) : { Accept: 'application/json' };
      // Do not forward browser cookies, auth, origin or proxy headers. A
      // resolution or download-start POST has a small bounded body; stream
      // responses remain streaming and retain Range metadata through this host.
      function forward(body, headersOverride = headers) {
        const upstream = http.request({ hostname: '127.0.0.1', port: gatewayPort,
          method: req.method, path: `${url.pathname}${url.search}`, headers: headersOverride, timeout: 35_000 }, (result) => {
          upstream.setTimeout(0); // timeout applies to response headers, not the media body
          const outgoing = { 'Cache-Control': 'no-store' };
          for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'x-content-type-options']) {
            if (result.headers[name]) outgoing[name] = result.headers[name];
          }
          res.writeHead(result.statusCode || 502, outgoing);
          result.on('error', () => res.destroy());
          result.pipe(res);
        });
        upstream.on('timeout', () => upstream.destroy());
        upstream.on('error', () => { if (!res.destroyed) error(res, 502); });
        req.on('aborted', () => upstream.destroy());
        res.on('close', () => upstream.destroy());
        upstream.end(body);
      }
      if (!resolving) { forward(); return; }
      let length = 0;
      let tooLarge = false;
      const chunks = [];
      // Use flowing mode rather than an async iterator: exiting an iterator on
      // an oversized/aborted upload destroys the socket before a 413 is sent,
      // and an unhandled iterator rejection can terminate the host.
      req.on('data', chunk => {
        if (tooLarge) return; // drain the remainder without buffering it
        length += chunk.length;
        if (length > 2048) {
          tooLarge = true;
          chunks.length = 0;
          if (!res.destroyed) error(res, 413);
        } else chunks.push(chunk);
      });
      req.once('error', () => { if (!res.destroyed) error(res, 400); });
      req.once('end', () => {
        if (!tooLarge && !res.destroyed && !req.aborted) forward(Buffer.concat(chunks));
      });
      return;
    }
    if (!webroot || !['GET', 'HEAD'].includes(req.method || '')) return error(res, 404);
    try {
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0')) return error(res, 404);
      const candidate = path.resolve(webroot, `.${pathname === '/' ? '/index.html' : pathname}`);
      const actual = await realpath(candidate);
      if (actual !== webroot && !actual.startsWith(`${webroot}${path.sep}`)) return error(res, 404);
      const info = await stat(actual);
      if (!info.isFile()) return error(res, 404);
      res.writeHead(200, { 'Content-Type': mime[path.extname(actual).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(actual).on('error', () => res.destroy()).pipe(res);
    } catch { error(res, 404); }
  }
  server = http.createServer((req, res) => {
    void handleRequest(req, res).catch(() => { if (!res.destroyed) error(res, 500); });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bind, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Host failed to bind');
  // Desktop consumes exactly this line; preview users use their same origin.
  console.log(`THEMASHUP_HOST_PORT=${address.port}`);
  if (preview) console.error(`TheMashup preview listening on port ${address.port}`);
} catch (err) {
  console.error(`Search host could not start: ${err instanceof Error ? err.message : String(err)}`);
  shutdown(1);
}
