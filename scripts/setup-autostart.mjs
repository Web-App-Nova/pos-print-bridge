#!/usr/bin/env node
/**
 * One-time auto-start setup. Run from pos-print-bridge folder:
 *   npm run setup:autostart
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const platform = os.platform();

console.log('[pos-print-bridge] Installing dependencies and building…');
const install = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: true });
if (install.status !== 0) process.exit(install.status ?? 1);

const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

let script = '';
if (platform === 'darwin') {
  script = path.join(__dirname, 'macos-install-autostart.sh');
} else if (platform === 'win32') {
  script = path.join(__dirname, 'windows-install-autostart.ps1');
} else {
  script = path.join(__dirname, 'linux-install-autostart.sh');
}

console.log(`[pos-print-bridge] Configuring auto-start for ${platform}…`);

if (platform === 'win32') {
  const result = spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', script, '-BridgeRoot', root],
    { stdio: 'inherit', shell: true },
  );
  process.exit(result.status ?? 1);
}

const result = spawnSync('bash', [script, root], { stdio: 'inherit' });
process.exit(result.status ?? 1);
