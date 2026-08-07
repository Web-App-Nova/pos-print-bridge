import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as net from 'node:net';
import { PRINT_TIMEOUT_MS } from './config.js';
import { execFileHidden, powershellHiddenArgs, spawnHidden } from './exec.js';
import { resolveScriptPath } from './paths.js';
import {
  isUsbDeviceUri,
  resolveCupsDeviceUri,
  sendDarwinUsbBackendPrint,
} from './print-darwin.js';
import {
  confirmQueuePrint,
  listQueueJobs,
  parseCupsSubmitJobId,
  type ConfirmPrintResult,
} from './queue.js';

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
  printed: boolean;
  status: 'printed' | 'failed';
  method: 'raw-tcp' | 'cups-queue' | 'cups-usb-backend' | 'windows-queue';
  target: string;
  bytes_sent: number;
  host?: string;
  port?: number;
  os_job_id?: string | null;
  queue_jobs?: number;
  printer_state?: string;
  message: string;
}

export class PrintConfirmError extends Error {
  result: PrintJobResult;

  constructor(result: PrintJobResult) {
    super(result.message);
    this.name = 'PrintConfirmError';
    this.result = result;
  }
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

function withConfirm(
  base: Omit<PrintJobResult, 'printed' | 'status' | 'message' | 'ok'> & {
    ok?: boolean;
    message?: string;
  },
  confirm: ConfirmPrintResult,
): PrintJobResult {
  return {
    ...base,
    ok: confirm.printed,
    printed: confirm.printed,
    status: confirm.status,
    message: confirm.message,
    os_job_id: confirm.os_job_id ?? base.os_job_id ?? null,
    queue_jobs: confirm.queue_jobs,
    printer_state: confirm.printer_state,
  };
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
    throw new Error(
      `Port ${port} is not supported for raw thermal printing. Use USB queue or LAN port 9100.`,
    );
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
          printed: true,
          status: 'printed',
          method: 'raw-tcp',
          target: `${host}:${port}`,
          host,
          port,
          bytes_sent: payload.length,
          message: 'Printed successfully',
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
    socket.once('timeout', () =>
      finish(new Error(`Print timed out after ${PRINT_TIMEOUT_MS}ms`)),
    );
    socket.once('error', (error) => finish(error));
    socket.connect(port, host);
  });
}

async function lpStdinRaw(queue: string, payload: Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawnHidden(
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
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdin?.write(payload);
    child.stdin?.end();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
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
  let osJobId: string | null = null;
  let method: PrintJobResult['method'] = 'cups-queue';

  try {
    let deviceUri = uri?.trim() || null;
    if (!deviceUri) deviceUri = await resolveCupsDeviceUri(queue);

    // macOS POS-Printer driver often strips ESC/POS via lp — send via USB backend instead.
    if (process.platform === 'darwin' && isUsbDeviceUri(deviceUri)) {
      try {
        await sendDarwinUsbBackendPrint(deviceUri!, file);
        // Direct USB backend — no OS spooler job. Success = bytes delivered to backend.
        return {
          ok: true,
          printed: true,
          status: 'printed',
          method: 'cups-usb-backend',
          target: queue,
          bytes_sent: payload.length,
          os_job_id: null,
          message: 'Printed successfully',
        };
      } catch {
        // fall back to lp stdin
      }
    }

    try {
      const stdout = await lpStdinRaw(queue, payload);
      osJobId = parseCupsSubmitJobId(stdout);
    } catch {
      const { stdout } = await execFileHidden(
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
      osJobId = parseCupsSubmitJobId(stdout || '');
      method = 'cups-queue';
    }
  } finally {
    await unlink(file).catch(() => undefined);
  }

  const confirm = await confirmQueuePrint({ queue, osJobId });
  const result = withConfirm(
    {
      method,
      target: queue,
      bytes_sent: payload.length,
      os_job_id: osJobId,
    },
    confirm,
  );
  if (!result.printed) throw new PrintConfirmError(result);
  return result;
}

async function sendWindowsQueuePrint(queue: string, payload: Buffer): Promise<PrintJobResult> {
  const file = join(tmpdir(), `pos-print-${Date.now()}.raw`);
  await writeFile(file, payload);
  const script = resolveScriptPath('windows-raw-print.ps1');
  let osJobId: string | null = null;
  try {
    const { stdout } = await execFileHidden(
      'powershell',
      powershellHiddenArgs(['-File', script, '-PrinterName', queue, '-FilePath', file]),
      { timeout: PRINT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    try {
      const parsed = JSON.parse(stdout.trim() || '{}') as { os_job_id?: string };
      osJobId = parsed.os_job_id ? String(parsed.os_job_id) : null;
    } catch {
      osJobId = null;
    }
  } finally {
    await unlink(file).catch(() => undefined);
  }

  const confirm = await confirmQueuePrint({ queue, osJobId });
  const result = withConfirm(
    {
      method: 'windows-queue',
      target: queue,
      bytes_sent: payload.length,
      os_job_id: osJobId,
    },
    confirm,
  );
  if (!result.printed) throw new PrintConfirmError(result);
  return result;
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
    (queue &&
      (job.kind === 'usb' ||
        job.connection_type === 'usb' ||
        job.connection_type === 'bluetooth'))
  ) {
    if (!queue) {
      throw new Error(
        'USB printer queue missing. Re-select GP-C80250I Plus in Printer Config.',
      );
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

/** Expose queue job count helper for API responses. */
export async function pendingJobCount(queue: string): Promise<number> {
  const jobs = await listQueueJobs(queue);
  return jobs.length;
}
