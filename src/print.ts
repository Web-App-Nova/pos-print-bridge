import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as net from 'node:net';
import { PRINT_TIMEOUT_MS } from './config.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PrintJobRequest {
  host?: string;
  port?: number;
  queue?: string;
  device_id?: string;
  connection_type?: 'network' | 'usb' | 'bluetooth';
  kind?: string;
  text?: string;
  data_base64?: string;
}

export interface PrintJobResult {
  ok: boolean;
  method: 'raw-tcp' | 'cups-queue' | 'windows-queue';
  target: string;
  bytes_sent: number;
  host?: string;
  port?: number;
}

function decodePayload(body: PrintJobRequest): Buffer {
  if (body.data_base64) return Buffer.from(body.data_base64, 'base64');
  if (body.text != null) return Buffer.from(body.text, 'utf8');
  throw new Error('Provide text or data_base64');
}

function resolveQueue(job: PrintJobRequest): string | undefined {
  const direct = job.queue?.trim();
  if (direct) return direct;
  if (job.device_id?.startsWith('system:')) {
    return job.device_id.slice('system:'.length).trim() || undefined;
  }
  return undefined;
}

function isUsbLike(job: PrintJobRequest): boolean {
  return (
    job.kind === 'usb' ||
    job.kind === 'bluetooth' ||
    job.kind === 'local' ||
    job.connection_type === 'usb' ||
    job.connection_type === 'bluetooth' ||
    Boolean(resolveQueue(job) && !job.host)
  );
}

export function sendRawTcpPrint(
  host: string,
  port: number,
  payload: Buffer,
): Promise<PrintJobResult> {
  if (port === 631) {
    throw new Error(
      'Port 631 is IPP/CUPS — it cannot print raw ESC/POS. Select your USB printer (e.g. GP-C80250I Plus) from the dropdown, not a LAN IP.',
    );
  }
  if (port !== 9100 && port !== 515) {
    throw new Error(`Port ${port} is not supported for raw thermal printing. Use USB queue or LAN port 9100.`);
  }

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else {
        resolve({
          ok: true,
          method: 'raw-tcp',
          target: `${host}:${port}`,
          host,
          port,
          bytes_sent: payload.length,
        });
      }
    };

    socket.setTimeout(PRINT_TIMEOUT_MS);
    socket.once('connect', () => {
      socket.write(payload, (writeError) => {
        if (writeError) return finish(writeError);
        socket.end(() => finish());
      });
    });
    socket.once('timeout', () => finish(new Error(`Print timed out after ${PRINT_TIMEOUT_MS}ms`)));
    socket.once('error', (error) => finish(error));
    socket.connect(port, host);
  });
}

async function sendCupsQueuePrint(queue: string, payload: Buffer): Promise<PrintJobResult> {
  const file = join(tmpdir(), `pos-print-${Date.now()}.raw`);
  await writeFile(file, payload);

  try {
    const { stdout, stderr } = await execFileAsync(
      'lp',
      ['-d', queue, '-o', 'raw', '-o', 'document-format=application/octet-stream', file],
      { timeout: PRINT_TIMEOUT_MS },
    );
    const combined = `${stdout || ''}${stderr || ''}`;
    if (/unknown printer|does not exist|unable to/i.test(combined)) {
      throw new Error(`Printer queue "${queue}" not found. Re-select it in Printer Config.`);
    }
  } finally {
    await unlink(file).catch(() => undefined);
  }

  return { ok: true, method: 'cups-queue', target: queue, bytes_sent: payload.length };
}

async function sendWindowsQueuePrint(queue: string, payload: Buffer): Promise<PrintJobResult> {
  const file = join(tmpdir(), `pos-print-${Date.now()}.raw`);
  await writeFile(file, payload);
  const script = join(__dirname, '..', 'scripts', 'windows-raw-print.ps1');
  try {
    await execFileAsync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-PrinterName', queue, '-FilePath', file],
      { timeout: PRINT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
  } finally {
    await unlink(file).catch(() => undefined);
  }
  return { ok: true, method: 'windows-queue', target: queue, bytes_sent: payload.length };
}

async function sendQueuePrint(queue: string, payload: Buffer): Promise<PrintJobResult> {
  if (process.platform === 'win32') return sendWindowsQueuePrint(queue, payload);
  return sendCupsQueuePrint(queue, payload);
}

export async function sendPrintJob(job: PrintJobRequest): Promise<PrintJobResult> {
  const payload = decodePayload(job);
  const queue = resolveQueue(job);
  const host = job.host?.trim();
  const port = Number(job.port || 9100);
  const usbLike = isUsbLike(job);

  if (usbLike || (queue && (job.kind === 'usb' || job.connection_type === 'usb' || job.connection_type === 'bluetooth'))) {
    if (!queue) {
      throw new Error(
        'USB printer queue missing. Open Printer Config → Refresh → select GP-C80250I Plus (USB), then Save.',
      );
    }
    return sendQueuePrint(queue, payload);
  }

  if (queue && !host) {
    return sendQueuePrint(queue, payload);
  }

  if (host) {
    return sendRawTcpPrint(host, port, payload);
  }

  if (queue) {
    return sendQueuePrint(queue, payload);
  }

  throw new Error('Select a system printer from the dropdown before printing.');
}

export function sendRawPrint(job: PrintJobRequest & { host: string }): Promise<PrintJobResult> {
  return sendPrintJob(job);
}
