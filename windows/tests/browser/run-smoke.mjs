// Launch the actual same-origin host with deterministic fixtures and wait for
// its readiness line before opening Playwright. No external music providers are
// contacted; this checks wiring, not live service availability.
import { spawn } from 'node:child_process';
import path from 'node:path';

const webroot = process.argv[2];
if (!webroot) throw new Error('Browser webroot is required');
const host = spawn(process.execPath, ['services/host.mjs', '--preview', '--webroot', webroot, '--bind', '127.0.0.1', '--port', '8080'], {
  cwd: process.cwd(),
  env: { ...process.env, RESOLVER_MOCK: '1', MOCK_UPSTREAM: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
host.stderr.pipe(process.stderr);
let ready = false;
try {
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Search host startup timed out')), 35_000);
    host.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('THEMASHUP_HOST_PORT=8080')) { ready = true; clearTimeout(timer); resolve(); }
    });
    host.once('error', error => { clearTimeout(timer); reject(error); });
    host.once('exit', code => { if (!ready) { clearTimeout(timer); reject(new Error(`Search host exited before ready (${code})`)); } });
  });
  const test = spawn(process.execPath, [path.join('tests', 'browser', 'smoke.mjs')], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { test.once('error', reject); test.once('exit', resolve); });
  if (code !== 0) process.exitCode = typeof code === 'number' ? code : 1;
} finally {
  host.kill('SIGTERM');
}
