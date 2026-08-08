#!/usr/bin/env node
/**
 * Build TypeScript and assemble a portable runtime (official Node binary + app).
 *
 * Layout per target:
 *   release/bin/<target>/
 *     node | node.exe
 *     pos-print-bridge | pos-print-bridge.cmd
 *     app/build/...
 *     app/node_modules/...
 *     scripts/windows-raw-print.ps1
 *     VERSION
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { tmpdir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const platformArg = args.includes('--platform')
  ? args[args.indexOf('--platform') + 1]
  : 'all';

const pkgJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkgJson.version;
const NODE_VERSION = process.env.POS_PRINT_BRIDGE_NODE_VERSION || '20.18.1';

const targets = [];
if (platformArg === 'all' || platformArg === 'macos') {
  targets.push(
    {
      id: 'macos-arm64',
      nodeArchive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
      nodeBin: 'bin/node',
    },
    {
      id: 'macos-x64',
      nodeArchive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
      nodeBin: 'bin/node',
    },
  );
}
if (platformArg === 'all' || platformArg === 'windows') {
  targets.push({
    id: 'win-x64',
    nodeArchive: `node-v${NODE_VERSION}-win-x64.zip`,
    nodeBin: 'node.exe',
    isWindows: true,
  });
}

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https
        .get(u, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            return follow(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed ${res.statusCode}: ${u}`));
          }
          const out = createWriteStream(dest);
          pipeline(res, out).then(resolve).catch(reject);
        })
        .on('error', reject);
    };
    follow(url);
  });
}

async function fetchNodeRuntime(target, cacheDir) {
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${target.nodeArchive}`;
  const archivePath = path.join(cacheDir, target.nodeArchive);
  if (!existsSync(archivePath)) {
    console.log(`[package] Downloading Node ${NODE_VERSION} (${target.id})…`);
    await download(url, archivePath);
  } else {
    console.log(`[package] Using cached ${target.nodeArchive}`);
  }

  const extractRoot = path.join(cacheDir, `extract-${target.id}`);
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });

  if (target.nodeArchive.endsWith('.zip')) {
    const result = spawnSync('unzip', ['-q', '-o', archivePath, '-d', extractRoot], {
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('unzip failed — install unzip or run on macOS/Linux');
    const inner = path.join(extractRoot, `node-v${NODE_VERSION}-win-x64`);
    return existsSync(inner) ? inner : extractRoot;
  }

  // strip-components=1 so extractRoot contains bin/node directly
  const result = spawnSync(
    'tar',
    ['-xzf', archivePath, '-C', extractRoot, '--strip-components=1'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('tar extract failed');
  return extractRoot;
}

function writeUnixLauncher(outDir) {
  const content = `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export POS_PRINT_BRIDGE_ENV="\${POS_PRINT_BRIDGE_ENV:-production}"
exec "$DIR/node" "$DIR/app/build/index.js" "$@"
`;
  const dest = path.join(outDir, 'pos-print-bridge');
  writeFileSync(dest, content, 'utf8');
  chmodSync(dest, 0o755);
}

function writeWindowsLauncher(outDir) {
  const content = `@echo off
setlocal
set "DIR=%~dp0"
if "%POS_PRINT_BRIDGE_ENV%"=="" set "POS_PRINT_BRIDGE_ENV=production"
"%DIR%node.exe" "%DIR%app\\build\\index.js" %*
`;
  writeFileSync(path.join(outDir, 'pos-print-bridge.cmd'), content, 'utf8');
}

console.log('[package] Building TypeScript…');
run('npm', ['run', 'build']);

console.log('[package] Installing production dependencies into staging…');
const prodStage = path.join(root, 'release', '.prod-app');
rmSync(prodStage, { recursive: true, force: true });
mkdirSync(prodStage, { recursive: true });
copyFileSync(path.join(root, 'package.json'), path.join(prodStage, 'package.json'));
copyFileSync(path.join(root, 'package-lock.json'), path.join(prodStage, 'package-lock.json'));
run('npm', ['ci', '--omit=dev', '--prefix', prodStage]);
cpSync(path.join(root, 'build'), path.join(prodStage, 'build'), { recursive: true });

const cacheDir = path.join(tmpdir(), 'pos-print-bridge-node-cache');
mkdirSync(cacheDir, { recursive: true });
const binRoot = path.join(root, 'release', 'bin');
mkdirSync(binRoot, { recursive: true });

for (const target of targets) {
  const outDir = path.join(binRoot, target.id);
  console.log(`[package] Assembling ${target.id}…`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const nodeRoot = await fetchNodeRuntime(target, cacheDir);
  if (target.isWindows) {
    copyFileSync(path.join(nodeRoot, 'node.exe'), path.join(outDir, 'node.exe'));
    writeWindowsLauncher(outDir);
  } else {
    copyFileSync(path.join(nodeRoot, target.nodeBin), path.join(outDir, 'node'));
    chmodSync(path.join(outDir, 'node'), 0o755);
    writeUnixLauncher(outDir);
  }

  cpSync(prodStage, path.join(outDir, 'app'), { recursive: true });
  rmSync(path.join(outDir, 'app', 'package-lock.json'), { force: true });

  const scriptsOut = path.join(outDir, 'scripts');
  mkdirSync(scriptsOut, { recursive: true });
  copyFileSync(
    path.join(root, 'scripts', 'windows-raw-print.ps1'),
    path.join(scriptsOut, 'windows-raw-print.ps1'),
  );
  mkdirSync(path.join(outDir, 'app', 'scripts'), { recursive: true });
  copyFileSync(
    path.join(root, 'scripts', 'windows-raw-print.ps1'),
    path.join(outDir, 'app', 'scripts', 'windows-raw-print.ps1'),
  );

  copyFileSync(path.join(root, 'package.json'), path.join(outDir, 'package.json'));
  writeFileSync(path.join(outDir, 'VERSION'), `${version}\n`, 'utf8');
  console.log(`[package] Ready: ${outDir}`);
}

console.log(
  `[package] Done. Portable runtimes under release/bin/ (app v${version}, Node ${NODE_VERSION})`,
);
