import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getLogDir } from './paths.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATED = 5;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function logFilePath(): string {
  return join(getLogDir(), 'agent.log');
}

function rotateIfNeeded(): void {
  const file = logFilePath();
  if (!existsSync(file)) return;
  try {
    if (statSync(file).size < MAX_LOG_BYTES) return;
  } catch {
    return;
  }
  for (let i = MAX_ROTATED - 1; i >= 1; i--) {
    const src = `${file}.${i}`;
    const dest = `${file}.${i + 1}`;
    if (existsSync(src)) {
      try {
        renameSync(src, dest);
      } catch {
        /* ignore */
      }
    }
  }
  try {
    renameSync(file, `${file}.1`);
  } catch {
    /* ignore */
  }
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const dir = getLogDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }

  const metaStr =
    meta && Object.keys(meta).length
      ? ` ${JSON.stringify(meta)}`
      : '';
  const line = `${timestamp()} ${level.padEnd(5)} ${message}${metaStr}`;

  // Console for service stdout capture
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);

  try {
    rotateIfNeeded();
    appendFileSync(logFilePath(), `${line}\n`, 'utf8');
  } catch {
    /* best effort */
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('DEBUG', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('INFO', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('WARN', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('ERROR', message, meta),
  flush: () => {
    /* sync appends — nothing buffered */
  },
};
