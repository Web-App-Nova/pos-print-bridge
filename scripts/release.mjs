#!/usr/bin/env node
/**
 * Package binaries then build platform installers.
 * Usage:
 *   node scripts/release.mjs
 *   node scripts/release.mjs --platform macos
 *   node scripts/release.mjs --platform windows
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const platformArg = args.includes('--platform')
  ? args[args.indexOf('--platform') + 1]
  : 'all';

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const host = os.platform();

console.log('[release] Packaging binaries…');
run('node', ['scripts/package.mjs', '--platform', platformArg === 'all' ? 'all' : platformArg]);

mkdirSync(path.join(root, 'release', 'windows'), { recursive: true });
mkdirSync(path.join(root, 'release', 'macos'), { recursive: true });

if (platformArg === 'all' || platformArg === 'macos') {
  if (host === 'darwin') {
    const script = path.join(root, 'installer', 'macos', 'build-pkg.sh');
    chmodSync(script, 0o755);
    console.log('[release] Building macOS .pkg…');
    run('bash', [script]);
  } else {
    console.warn('[release] Skipping macOS .pkg (must build on macOS).');
  }
}

if (platformArg === 'all' || platformArg === 'windows') {
  const script = path.join(root, 'installer', 'windows', 'build-installer.sh');
  const ps1 = path.join(root, 'installer', 'windows', 'build-installer.ps1');
  if (host === 'win32' && existsSync(ps1)) {
    console.log('[release] Building Windows installer…');
    run('powershell', ['-ExecutionPolicy', 'Bypass', '-File', ps1]);
  } else if (existsSync(script)) {
    console.log('[release] Preparing Windows installer payload…');
    chmodSync(script, 0o755);
    run('bash', [script]);
  } else {
    console.warn('[release] Windows installer scripts missing.');
  }
}

console.log('[release] Artifacts:');
console.log('  release/bin/');
console.log('  release/windows/');
console.log('  release/macos/');
