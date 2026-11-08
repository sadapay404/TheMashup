/**
 * Copies the built web bundle into the Android project's assets and verifies the result.
 * Kept as a plain script (no Capacitor CLI dependency at build time) so CI and local builds behave
 * identically and a missing bundle fails loudly instead of producing an empty APK.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const dist = join(repo, 'apps/web/dist');
const assets = join(repo, 'apps/android/android/app/src/main/assets/public');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('✗ apps/web/dist/index.html is missing — run `npm run build` first.');
  process.exit(1);
}

rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });
cpSync(dist, assets, { recursive: true });

const files = readdirSync(assets);
console.log(`✓ synced ${files.length} top-level entries into Android assets`);
console.log(`  ${assets}`);
