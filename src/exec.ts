import { execFile, spawn, type ExecFileOptions, type SpawnOptions } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * On Windows, never flash a console for child tools (PowerShell, etc.).
 * Safe no-op on macOS/Linux.
 */
export const HIDDEN_EXEC: ExecFileOptions = {
  windowsHide: true,
};

export const HIDDEN_SPAWN: SpawnOptions = {
  windowsHide: true,
};

const execFileBase = promisify(execFile);

export async function execFileHidden(
  file: string,
  args: readonly string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileBase(file, [...args], {
    ...HIDDEN_EXEC,
    ...options,
  });
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

/** PowerShell args that suppress profile + visible window. */
export function powershellHiddenArgs(commandOrFileArgs: string[]): string[] {
  return ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', ...commandOrFileArgs];
}

export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
) {
  return spawn(command, [...args], {
    ...HIDDEN_SPAWN,
    ...options,
  });
}
