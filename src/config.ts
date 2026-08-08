import { readFileSync } from 'node:fs';
import * as os from 'os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getConfig } from './store.js';
import { getInstallDir, isPackaged, isProductionInstall } from './paths.js';

const startedAt = Date.now();

function readPackageVersion(): string {
  try {
    const candidates = [
      join(getInstallDir(), 'package.json'),
      join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    ];
    for (const path of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        /* try next */
      }
    }
  } catch {
    /* ignore */
  }
  return '1.1.0';
}

export const BRIDGE_VERSION = readPackageVersion();

/** Bind host — config file + env (env wins via store). Default localhost. */
export function getHost(): string {
  try {
    return getConfig().host || '127.0.0.1';
  } catch {
    return process.env.POS_PRINT_BRIDGE_HOST || '127.0.0.1';
  }
}

export function getPort(): number {
  try {
    return Number(getConfig().port || 9247);
  } catch {
    return Number(process.env.POS_PRINT_BRIDGE_PORT || 9247);
  }
}

/** @deprecated use getPort() — kept for existing imports */
export const DEFAULT_PORT = Number(process.env.POS_PRINT_BRIDGE_PORT || 9247);
/** @deprecated use getHost() */
export const HOST = process.env.POS_PRINT_BRIDGE_HOST || '127.0.0.1';

export const PRINT_TIMEOUT_MS = Number(process.env.POS_PRINT_TIMEOUT_MS || 8000);
/** Wait for OS spooler job to finish (leave queue) before reporting printed. */
export const PRINT_CONFIRM_TIMEOUT_MS = Number(
  process.env.POS_PRINT_CONFIRM_TIMEOUT_MS || 8_000,
);
/** Poll often so offline/error fails the job almost immediately. */
export const PRINT_CONFIRM_POLL_MS = Number(process.env.POS_PRINT_CONFIRM_POLL_MS || 300);
export const DISCOVERY_TIMEOUT_MS = Number(process.env.POS_DISCOVERY_TIMEOUT_MS || 220);

export function uptimeMs(): number {
  return Date.now() - startedAt;
}

export function bridgeStatus() {
  const host = getHost();
  const port = getPort();
  return {
    ok: true,
    version: BRIDGE_VERSION,
    platform: process.platform,
    hostname: os.hostname(),
    port,
    host,
    environment: (() => {
      try {
        return getConfig().environment;
      } catch {
        return 'development';
      }
    })(),
    packaged: isPackaged() || isProductionInstall(),
  };
}

export function healthStatus() {
  const base = bridgeStatus();
  return {
    status: 'running' as const,
    version: base.version,
    uptime: Math.floor(uptimeMs() / 1000),
    ok: true,
    platform: base.platform,
    hostname: base.hostname,
    port: base.port,
    host: base.host,
    environment: base.environment,
    packaged: base.packaged,
  };
}
