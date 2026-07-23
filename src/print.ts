import * as net from 'net';
import { PRINT_TIMEOUT_MS } from './config.js';

export interface PrintJobRequest {
  host: string;
  port?: number;
  /** Plain text payload (UTF-8). */
  text?: string;
  /** Base64-encoded raw bytes (ESC/POS, etc.). */
  data_base64?: string;
}

export interface PrintJobResult {
  ok: boolean;
  host: string;
  port: number;
  bytes_sent: number;
}

function decodePayload(body: PrintJobRequest): Buffer {
  if (body.data_base64) {
    return Buffer.from(body.data_base64, 'base64');
  }
  if (body.text != null) {
    return Buffer.from(body.text, 'utf8');
  }
  throw new Error('Provide text or data_base64');
}

export function sendRawPrint(job: PrintJobRequest): Promise<PrintJobResult> {
  const host = job.host?.trim();
  if (!host) throw new Error('host is required');

  const port = Number(job.port || 9100);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port');
  }

  const payload = decodePayload(job);

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve({ ok: true, host, port, bytes_sent: payload.length });
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
