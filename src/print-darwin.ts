import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { PRINT_TIMEOUT_MS } from './config.js';
import { execFileHidden } from './exec.js';

const USB_BACKEND = '/usr/libexec/cups/backend/usb';

function normalizeQueueName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '');
}

/** Resolve CUPS device URI for a queue, e.g. usb://GPrinter/GP-C80250I%20Plus?... */
export async function resolveCupsDeviceUri(queue: string): Promise<string | null> {
  try {
    const { stdout } = await execFileHidden('lpstat', ['-v'], { timeout: 8000 });
    const target = normalizeQueueName(queue);
    for (const line of stdout.split('\n')) {
      const match = line.match(/^device for (.+):\s*(.+)$/i);
      if (!match) continue;
      const queueName = match[1].trim();
      if (normalizeQueueName(queueName) !== target) continue;
      return match[2].trim();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Send ESC/POS straight to USB via CUPS backend (bypasses Mac POS driver filter
 * that often eats raw bytes and prints blank paper).
 */
export async function sendDarwinUsbBackendPrint(
  deviceUri: string,
  filePath: string,
  title = 'POS KOT',
): Promise<void> {
  await access(USB_BACKEND, constants.X_OK);
  const user = process.env.USER || 'pos';
  await execFileHidden(
    USB_BACKEND,
    [deviceUri, '1', user, title, '1', '', filePath],
    { timeout: PRINT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
  );
}

export function isUsbDeviceUri(uri?: string | null): boolean {
  return Boolean(uri?.toLowerCase().startsWith('usb://'));
}
