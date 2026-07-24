import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as net from 'node:net';
import { PRINT_TIMEOUT_MS } from './config.js';
import {
  isUsbDeviceUri,
  resolveCupsDeviceUri,
  sendDarwinUsbBackendPrint,
} from './print-darwin.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PrintJobRequest {
  host?: string;
  port?: number;
  queue?: string;
  device_id?: string;
  uri?: string;
  connection_type?: 'network' | 'usb' | 'bluetooth';
  kind?: string;
  text?: string;
  data_base64?: string;
}

export interface PrintJobResult {
  ok: boolean;
  method: 'raw-tcp' | 'cups-queue' | 'cups-usb-backend' | 'windows-queue';
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
    isUsbDeviceUri(job.uri) ||
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
      'Port 631 is IPP/CUPS — select your USB printer (GP-C80250I Plus) from the dropdown.',
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

async function lpStdinRaw(queue: string, payload: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'lp',
      [
        '-d',
        queue,
        '-o',
        'raw',
        '-o',
        'document-format=application/octet-stream',
        '-o',
        'fit-to-page=false',
        '-t',
        'POS KOT',
        '-',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.write(payload);
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `lp exited with code ${code}`));
    });
  });
}

async function sendCupsQueuePrint(
  queue: string,
  payload: Buffer,
  uri?: string,
): Promise<PrintJobResult> {
  const file = join(tmpdir(), `pos-print-${Date.now()}.raw`);
  await writeFile(file, payload);

  try {
    let deviceUri = uri?.trim() || null;
    if (!deviceUri) deviceUri = await resolveCupsDeviceUri(queue);

    // macOS POS-Printer driver often strips ESC/POS via lp — send via USB backend instead.
    if (process.platform === 'darwin' && isUsbDeviceUri(deviceUri)) {
      try {
        await sendDarwinUsbBackendPrint(deviceUri!, file);
        return {
          ok: true,
          method: 'cups-usb-backend',
          target: queue,
          bytes_sent: payload.length,
        };
      } catch {
        // fall back to lp stdin
      }
    }

    try {
      await lpStdinRaw(queue, payload);
    } catch {
      await execFileAsync(
        'lp',
        [
          '-d',
          queue,
          '-o',
          'raw',
          '-o',
          'document-format=application/octet-stream',
          '-o',
          'fit-to-page=false',
          file,
        ],
        { timeout: PRINT_TIMEOUT_MS },
      );
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

async function sendQueuePrint(
  queue: string,
  payload: Buffer,
  uri?: string,
): Promise<PrintJobResult> {
  if (process.platform === 'win32') return sendWindowsQueuePrint(queue, payload);
  return sendCupsQueuePrint(queue, payload, uri);
}

export async function sendPrintJob(job: PrintJobRequest): Promise<PrintJobResult> {
  const payload = decodePayload(job);
  const queue = resolveQueue(job);
  const host = job.host?.trim();
  const port = Number(job.port || 9100);
  const uri = job.uri?.trim();

  if (
    isUsbLike(job) ||
    (queue && (job.kind === 'usb' || job.connection_type === 'usb' || job.connection_type === 'bluetooth'))
  ) {
    if (!queue) {
      throw new Error('USB printer queue missing. Re-select GP-C80250I Plus in Printer Config.');
    }
    return sendQueuePrint(queue, payload, uri);
  }

  if (queue && !host) {
    return sendQueuePrint(queue, payload, uri);
  }

  if (host) {
    return sendRawTcpPrint(host, port, payload);
  }

  if (queue) {
    return sendQueuePrint(queue, payload, uri);
  }

  throw new Error('Select a system printer from the dropdown before printing.');
}

export function sendRawPrint(job: PrintJobRequest & { host: string }): Promise<PrintJobResult> {
  return sendPrintJob(job);
}
