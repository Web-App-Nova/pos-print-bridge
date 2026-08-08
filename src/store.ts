import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { getConfigPath, ensureAppDirs } from './paths.js';
import { logger } from './logger.js';

export type AgentEnvironment = 'development' | 'staging' | 'production';

export interface StoredPrinter {
  id: string;
  name: string;
  type: 'LAN' | 'USB' | 'BLUETOOTH' | 'LOCAL';
  ip?: string;
  port?: number;
  queue?: string;
  uri?: string;
  paperWidth?: number;
  enabled: boolean;
}

export interface AgentConfig {
  version: number;
  environment: AgentEnvironment;
  host: string;
  port: number;
  /** When set, require Authorization: Bearer <token>. Empty = disabled (POS default). */
  authToken: string;
  printers: StoredPrinter[];
  /** Placeholder for future auto-update. */
  updateChannel?: string;
  updateUrl?: string;
  maxRetries: number;
  retryDelayMs: number;
}

const CONFIG_VERSION = 1;

function defaultEnvironment(): AgentEnvironment {
  const raw = (process.env.POS_PRINT_BRIDGE_ENV || '').toLowerCase();
  if (raw === 'staging' || raw === 'production' || raw === 'development') return raw;
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

export function defaultConfig(): AgentConfig {
  return {
    version: CONFIG_VERSION,
    environment: defaultEnvironment(),
    host: process.env.POS_PRINT_BRIDGE_HOST || '127.0.0.1',
    port: Number(process.env.POS_PRINT_BRIDGE_PORT || 9247),
    authToken: '',
    printers: [],
    updateChannel: 'stable',
    updateUrl: '',
    maxRetries: Number(process.env.POS_PRINT_BRIDGE_MAX_RETRIES || 2),
    retryDelayMs: Number(process.env.POS_PRINT_BRIDGE_RETRY_DELAY_MS || 1500),
  };
}

let cached: AgentConfig | null = null;

export function loadConfig(): AgentConfig {
  ensureAppDirs();
  const path = getConfigPath();
  if (!existsSync(path)) {
    const cfg = defaultConfig();
    saveConfig(cfg);
    cached = cfg;
    logger.info('Created default configuration', { path });
    return cfg;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AgentConfig>;
    const cfg: AgentConfig = {
      ...defaultConfig(),
      ...raw,
      version: CONFIG_VERSION,
      printers: Array.isArray(raw.printers) ? raw.printers : [],
    };
    // Env vars always win for bind address when set.
    if (process.env.POS_PRINT_BRIDGE_HOST) cfg.host = process.env.POS_PRINT_BRIDGE_HOST;
    if (process.env.POS_PRINT_BRIDGE_PORT) {
      cfg.port = Number(process.env.POS_PRINT_BRIDGE_PORT);
    }
    if (process.env.POS_PRINT_BRIDGE_ENV) cfg.environment = defaultEnvironment();
    cached = cfg;
    return cfg;
  } catch (error) {
    logger.error('Failed to read config — using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    const cfg = defaultConfig();
    cached = cfg;
    return cfg;
  }
}

export function saveConfig(config: AgentConfig): void {
  ensureAppDirs();
  const path = getConfigPath();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  cached = config;
}

export function getConfig(): AgentConfig {
  return cached ?? loadConfig();
}

export function updateConfig(patch: Partial<AgentConfig>): AgentConfig {
  const next = { ...getConfig(), ...patch, version: CONFIG_VERSION };
  saveConfig(next);
  return next;
}

/** Generate and persist a device token (install/setup). */
export function ensureAuthToken(): string {
  const cfg = getConfig();
  if (cfg.authToken) return cfg.authToken;
  const token = randomBytes(24).toString('hex');
  updateConfig({ authToken: token });
  logger.info('Generated device auth token');
  return token;
}

export function upsertStoredPrinter(printer: StoredPrinter): AgentConfig {
  const cfg = getConfig();
  const idx = cfg.printers.findIndex((p) => p.id === printer.id);
  const printers = [...cfg.printers];
  if (idx >= 0) printers[idx] = printer;
  else printers.push(printer);
  return updateConfig({ printers });
}
