import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when running inside a pkg-bundled executable. */
export function isPackaged(): boolean {
  return Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
}

/**
 * Directory containing the agent install (launcher + node + app/),
 * or the project root in development.
 */
export function getInstallDir(): string {
  if (process.env.POS_PRINT_BRIDGE_INSTALL_DIR) {
    return process.env.POS_PRINT_BRIDGE_INSTALL_DIR;
  }
  if (isPackaged()) {
    return dirname(process.execPath);
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url)); // .../build
  const appOrProject = join(moduleDir, '..'); // .../app or project root
  const portableRoot = join(appOrProject, '..');
  if (
    existsSync(join(portableRoot, 'node')) ||
    existsSync(join(portableRoot, 'node.exe')) ||
    existsSync(join(portableRoot, 'pos-print-bridge')) ||
    existsSync(join(portableRoot, 'pos-print-bridge.cmd'))
  ) {
    return portableRoot;
  }
  return appOrProject;
}

/** True for packaged/portable production installs (not `npm run dev`). */
export function isProductionInstall(): boolean {
  if (isPackaged()) return true;
  const install = getInstallDir();
  return (
    existsSync(join(install, 'node')) ||
    existsSync(join(install, 'node.exe')) ||
    existsSync(join(install, 'VERSION'))
  );
}

/** Resolve scripts/ assets next to the install or project root. */
export function getScriptsDir(): string {
  const install = getInstallDir();
  const candidates = [
    join(install, 'scripts'),
    join(install, 'app', 'scripts'),
    join(install, '..', 'scripts'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return join(install, 'scripts');
}

function windowsProgramData(): string {
  return process.env.PROGRAMDATA || 'C:\\ProgramData';
}

function windowsAppData(): string {
  return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
}

/** Persistent application data directory (config, job queue). */
export function getDataDir(): string {
  if (process.env.POS_PRINT_BRIDGE_DATA_DIR) {
    return process.env.POS_PRINT_BRIDGE_DATA_DIR;
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'pos-print-bridge');
  }
  if (process.platform === 'win32') {
    const programData = join(windowsProgramData(), 'POS Print Bridge');
    try {
      mkdirSync(programData, { recursive: true });
      return programData;
    } catch {
      return join(windowsAppData(), 'POS Print Bridge');
    }
  }
  return join(homedir(), '.local', 'share', 'pos-print-bridge');
}

/** Log directory (rotated agent logs). */
export function getLogDir(): string {
  if (process.env.POS_PRINT_BRIDGE_LOG_DIR) {
    return process.env.POS_PRINT_BRIDGE_LOG_DIR;
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Logs', 'pos-print-bridge');
  }
  if (process.platform === 'win32') {
    return join(getDataDir(), 'logs');
  }
  return join(homedir(), '.local', 'state', 'pos-print-bridge', 'logs');
}

export function getConfigPath(): string {
  return join(getDataDir(), 'config.json');
}

export function getJobsPath(): string {
  return join(getDataDir(), 'jobs.json');
}

export function ensureAppDirs(): void {
  mkdirSync(getDataDir(), { recursive: true });
  mkdirSync(getLogDir(), { recursive: true });
}
