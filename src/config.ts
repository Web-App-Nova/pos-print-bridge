import * as os from 'os';

export const BRIDGE_VERSION = '1.2.0';
export const DEFAULT_PORT = Number(process.env.POS_PRINT_BRIDGE_PORT || 9247);
export const HOST = process.env.POS_PRINT_BRIDGE_HOST || '127.0.0.1';
export const PRINT_TIMEOUT_MS = Number(process.env.POS_PRINT_TIMEOUT_MS || 8000);
/** Wait for OS spooler job to finish (leave queue) before reporting printed. */
export const PRINT_CONFIRM_TIMEOUT_MS = Number(
  process.env.POS_PRINT_CONFIRM_TIMEOUT_MS || 40_000,
);
/** Poll interval while waiting for OS job confirmation. */
export const PRINT_CONFIRM_POLL_MS = Number(process.env.POS_PRINT_CONFIRM_POLL_MS || 1000);
export const DISCOVERY_TIMEOUT_MS = Number(process.env.POS_DISCOVERY_TIMEOUT_MS || 220);

export function bridgeStatus() {
  return {
    ok: true,
    version: BRIDGE_VERSION,
    platform: process.platform,
    hostname: os.hostname(),
    port: DEFAULT_PORT,
    host: HOST,
  };
}
