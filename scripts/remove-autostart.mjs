#!/usr/bin/env node
/**
 * Remove auto-start. Run:
 *   npm run remove:autostart
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const platform = os.platform();

let script = '';
if (platform === 'darwin') {
  script = path.join(__dirname, 'macos-uninstall-autostart.sh');
} else if (platform === 'win32') {
  script = path.join(__dirname, 'windows-uninstall-autostart.ps1');
} else {
  script = path.join(__dirname, 'linux-uninstall-autostart.sh');
}

if (platform === 'win32') {
  const result = spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', script],
    { stdio: 'inherit', shell: true },
  );
  process.exit(result.status ?? 1);
}

const result = spawnSync('bash', [script], { stdio: 'inherit' });
process.exit(result.status ?? 1);
