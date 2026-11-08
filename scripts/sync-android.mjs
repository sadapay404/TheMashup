/**
 * One command to get a buildable Android project: build the web bundle, then run Capacitor's own
 * copy step. Written as a script so a missing bundle fails loudly instead of producing an empty APK,
 * and so the CLI lives in exactly one place (no duplicated asset-copying logic to drift).
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = join(repo, 'apps/web/dist/index.html');

if (!existsSync(indexHtml)) {
  console.error('✗ apps/web/dist/index.html is missing — run `npm run build` first.');
  process.exit(1);
}

const capBin = join(repo, 'node_modules/@capacitor/cli/bin/capacitor');
execFileSync(process.execPath, [capBin, 'copy', 'android'], {
  cwd: join(repo, 'apps/android'),
  stdio: 'inherit',
});

const copied = join(repo, 'apps/android/android/app/src/main/assets/public/index.html');
if (!existsSync(copied)) {
  console.error('✗ Capacitor copied nothing — check apps/android/capacitor.config.json webDir.');
  process.exit(1);
}
console.log('✓ web bundle synced into the Android project');
