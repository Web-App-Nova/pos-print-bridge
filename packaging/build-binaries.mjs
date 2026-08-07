#!/usr/bin/env node
/**
 * Bundle the bridge to a single CJS file, then package with @yao-pkg/pkg.
 *
 * Outputs:
 *   dist/bin/pos-print-bridge-win-x64.exe
 *   dist/bin/pos-print-bridge-macos-x64
 *   dist/bin/pos-print-bridge-macos-arm64
 *   dist/bin/scripts/windows-raw-print.ps1  (copied for installers)
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  cpSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const binDir = path.join(dist, 'bin');
const bundlePath = path.join(dist, 'bridge.cjs');

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });

console.log('[packaging] Typechecking…');
run('npx', ['tsc', '--noEmit']);

console.log('[packaging] Bundling with esbuild…');
run('npx', [
  'esbuild',
  'src/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node18',
  `--outfile=${bundlePath}`,
  '--legal-comments=none',
]);

const targets = [
  { pkg: 'node18-win-x64', out: 'pos-print-bridge-win-x64.exe' },
  { pkg: 'node18-macos-x64', out: 'pos-print-bridge-macos-x64' },
  { pkg: 'node18-macos-arm64', out: 'pos-print-bridge-macos-arm64' },
];

const only = process.argv.includes('--current')
  ? process.platform === 'win32'
    ? ['node18-win-x64']
    : process.arch === 'arm64'
      ? ['node18-macos-arm64']
      : ['node18-macos-x64']
  : null;

console.log('[packaging] Building binaries with pkg…');
for (const target of targets) {
  if (only && !only.includes(target.pkg)) continue;
  const outPath = path.join(binDir, target.out);
  run('npx', [
    'pkg',
    bundlePath,
    '--targets',
    target.pkg,
    '--output',
    outPath,
    '--compress',
    'GZip',
  ]);
}

const scriptsOut = path.join(binDir, 'scripts');
mkdirSync(scriptsOut, { recursive: true });
const ps1 = path.join(root, 'scripts', 'windows-raw-print.ps1');
if (existsSync(ps1)) {
  copyFileSync(ps1, path.join(scriptsOut, 'windows-raw-print.ps1'));
}

// Staging folder used by Inno / Mac installer scripts
const stageWin = path.join(dist, 'stage-win');
const stageMac = path.join(dist, 'stage-mac');
rmSync(stageWin, { recursive: true, force: true });
rmSync(stageMac, { recursive: true, force: true });
mkdirSync(stageWin, { recursive: true });
mkdirSync(stageMac, { recursive: true });

const winExe = path.join(binDir, 'pos-print-bridge-win-x64.exe');
if (existsSync(winExe)) {
  copyFileSync(winExe, path.join(stageWin, 'pos-print-bridge.exe'));
  cpSync(scriptsOut, path.join(stageWin, 'scripts'), { recursive: true });
  copyFileSync(
    path.join(__dirname, 'windows', 'install-autostart.ps1'),
    path.join(stageWin, 'install-autostart.ps1'),
  );
  copyFileSync(
    path.join(__dirname, 'windows', 'uninstall-autostart.ps1'),
    path.join(stageWin, 'uninstall-autostart.ps1'),
  );
}

const macBin =
  process.arch === 'arm64'
    ? path.join(binDir, 'pos-print-bridge-macos-arm64')
    : path.join(binDir, 'pos-print-bridge-macos-x64');
const macArm = path.join(binDir, 'pos-print-bridge-macos-arm64');
const macX64 = path.join(binDir, 'pos-print-bridge-macos-x64');
if (existsSync(macArm) || existsSync(macX64)) {
  const pick = existsSync(macBin) ? macBin : existsSync(macArm) ? macArm : macX64;
  copyFileSync(pick, path.join(stageMac, 'pos-print-bridge'));
  spawnSync('chmod', ['+x', path.join(stageMac, 'pos-print-bridge')]);
  copyFileSync(
    path.join(__dirname, 'macos', 'com.pos.print-bridge.plist'),
    path.join(stageMac, 'com.pos.print-bridge.plist'),
  );
  copyFileSync(
    path.join(__dirname, 'macos', 'install.sh'),
    path.join(stageMac, 'install.sh'),
  );
  copyFileSync(
    path.join(__dirname, 'macos', 'uninstall.sh'),
    path.join(stageMac, 'uninstall.sh'),
  );
  spawnSync('chmod', ['+x', path.join(stageMac, 'install.sh'), path.join(stageMac, 'uninstall.sh')]);
}

console.log('[packaging] Done.');
console.log(`  Binaries: ${binDir}`);
console.log(`  Windows stage: ${stageWin}`);
console.log(`  macOS stage: ${stageMac}`);
