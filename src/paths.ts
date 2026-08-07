import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when running inside a pkg packed binary. */
export function isPackagedBinary(): boolean {
  return Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
}

function devScriptsDir(): string {
  // ESM (tsc / tsx): scripts/ next to project root from build/ or src/
  try {
    const metaUrl = import.meta.url;
    if (metaUrl && metaUrl !== 'undefined') {
      const moduleDir = dirname(fileURLToPath(metaUrl));
      const fromModule = join(moduleDir, '..', 'scripts');
      if (existsSync(fromModule)) return fromModule;
    }
  } catch {
    /* CJS bundle has empty import.meta */
  }
  const fromCwd = join(process.cwd(), 'scripts');
  if (existsSync(fromCwd)) return fromCwd;
  return join(process.cwd(), 'scripts');
}

/**
 * Directory that holds helper scripts (e.g. windows-raw-print.ps1).
 * Packaged installs place `scripts/` next to the executable.
 */
export function resolveScriptsDir(): string {
  if (isPackagedBinary()) {
    return join(dirname(process.execPath), 'scripts');
  }
  return devScriptsDir();
}

export function resolveScriptPath(...segments: string[]): string {
  return join(resolveScriptsDir(), ...segments);
}
