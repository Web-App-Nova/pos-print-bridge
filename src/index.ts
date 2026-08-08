#!/usr/bin/env node
import cors from 'cors';
import express from 'express';
import type { Server } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bridgeStatus, getHost, getPort, healthStatus, BRIDGE_VERSION } from './config.js';
import { discoverAllPrinters, type UnifiedPrinterDevice } from './discover-all.js';
import { PrintConfirmError, type PrintJobRequest } from './print.js';
import {
  cancelQueueJob,
  getQueue,
  getQueueJob,
  listQueueJobs,
  listQueues,
} from './queue.js';
import { jobQueue, type JobType } from './job-queue.js';
import { ensureAppDirs, getAssetsDir } from './paths.js';
import { getConfig, loadConfig, upsertStoredPrinter, type StoredPrinter } from './store.js';
import { logger } from './logger.js';

ensureAppDirs();
loadConfig();
jobQueue.start();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const assetsDir = getAssetsDir();
if (existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir, { maxAge: '1d', index: false }));
}

/** Optional bearer auth when config.authToken is set. */
app.use((req, res, next) => {
  const token = getConfig().authToken;
  if (!token) return next();
  // Health/version/branding stay open for POS offline detection.
  if (
    req.path === '/' ||
    req.path === '/health' ||
    req.path === '/status' ||
    req.path === '/version' ||
    req.path.startsWith('/assets/')
  ) {
    return next();
  }
  const header = req.headers.authorization || '';
  const expected = `Bearer ${token}`;
  if (header !== expected) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }
  next();
});

function normalizePrinterId(id: string): string {
  return decodeURIComponent(id);
}

function toApiPrinter(device: UnifiedPrinterDevice) {
  const connectionType =
    device.connection_type === 'network'
      ? 'LAN'
      : device.connection_type === 'bluetooth'
        ? 'BLUETOOTH'
        : 'USB';
  return {
    id: device.id,
    name: device.name,
    connectionType,
    connection_type: device.connection_type,
    kind: device.kind,
    ip: device.host,
    host: device.host,
    port: device.port,
    queue: device.queue,
    uri: device.uri,
    protocol: device.protocol,
    detail: device.detail,
    label: device.label,
    source: device.source,
    status: 'unknown' as string,
  };
}

async function findPrinter(id: string): Promise<UnifiedPrinterDevice | null> {
  const result = await discoverAllPrinters();
  return result.devices.find((d) => d.id === id) || null;
}

function deviceToStored(device: UnifiedPrinterDevice): StoredPrinter {
  const type =
    device.connection_type === 'network'
      ? 'LAN'
      : device.connection_type === 'bluetooth'
        ? 'BLUETOOTH'
        : device.kind === 'local'
          ? 'LOCAL'
          : 'USB';
  return {
    id: device.id,
    name: device.name,
    type,
    ip: device.host,
    port: device.port,
    queue: device.queue,
    uri: device.uri,
    paperWidth: 80,
    enabled: true,
  };
}

function deviceToPrintPayload(device: UnifiedPrinterDevice, body: PrintJobRequest): PrintJobRequest {
  return {
    ...body,
    host: body.host ?? device.host,
    port: body.port ?? device.port,
    queue: body.queue ?? device.queue,
    device_id: body.device_id ?? device.id,
    uri: body.uri ?? device.uri,
    connection_type: body.connection_type ?? device.connection_type,
    kind: body.kind ?? device.kind,
  };
}

function testPrintText(): string {
  return (
    '\x1b@' +
    'POS Print Bridge\n' +
    'Test print OK\n' +
    `${new Date().toISOString()}\n\n\n\x1dV\x00`
  );
}

async function handlePrint(
  body: PrintJobRequest,
  jobType: JobType,
  printerId?: string,
): Promise<{ status: number; body: unknown }> {
  try {
    const result = await jobQueue.enqueueAndWait(body, jobType, printerId);
    return { status: 200, body: result };
  } catch (error) {
    if (error instanceof PrintConfirmError) {
      return { status: 422, body: error.result };
    }
    throw error;
  }
}

/* ─── Legacy POS-compatible routes ─── */

app.get('/', (_req, res) => {
  const health = healthStatus();
  const logoPath = join(assetsDir, 'logo.png');
  const iconPath = join(assetsDir, 'icon.svg');
  const logoSrc = existsSync(logoPath)
    ? '/assets/logo.png'
    : existsSync(iconPath)
      ? '/assets/icon.svg'
      : '';
  const faviconPng = join(assetsDir, 'favicon.png');
  const favicon = existsSync(faviconPng)
    ? '/assets/favicon.png'
    : existsSync(logoPath)
      ? '/assets/logo.png'
      : '/assets/icon.svg';
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>POS Printer Agent</title>
  <link rel="icon" href="${favicon}"/>
  <style>
    :root { color-scheme: light; }
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
      max-width: 40rem;
      margin: 2rem auto;
      padding: 0 1rem 2rem;
      color: #111;
      background: linear-gradient(180deg, #f6f4ef 0%, #fff 40%);
      min-height: 100vh;
    }
    .brand { display: flex; align-items: center; gap: 0.9rem; margin-bottom: 1.25rem; }
    .brand img {
      height: 64px;
      width: 64px;
      border-radius: 50%;
      display: block;
      background: #000;
      object-fit: cover;
    }
    h1 { font-size: 1.35rem; margin: 0; letter-spacing: -0.02em; }
    .ok { color: #0a7a32; font-weight: 600; margin: 0.35rem 0 1rem; }
    code, a { font-family: ui-monospace, Menlo, monospace; font-size: 0.9rem; }
    ul { line-height: 1.7; padding-left: 1.2rem; }
    p { color: #444; }
    footer { margin-top: 2rem; font-size: 0.8rem; color: #777; }
  </style>
</head>
<body>
  <div class="brand">
    ${logoSrc ? `<img src="${logoSrc}" alt="WEBAPPNOVA logo"/>` : ''}
    <div>
      <h1>POS Printer Agent</h1>
      <p class="ok">● Running</p>
    </div>
  </div>
  <p>Version ${health.version} · uptime ${health.uptime}s · ${health.host}:${health.port}</p>
  <p>This is an API service for the POS app — not a full website. Useful endpoints:</p>
  <ul>
    <li><a href="/health">/health</a></li>
    <li><a href="/status">/status</a></li>
    <li><a href="/version">/version</a></li>
    <li><a href="/printers">/printers</a></li>
    <li><a href="/jobs">/jobs</a></li>
  </ul>
  <footer>© 2026 WEBAPPNOVA LLP · Proprietary license · See LICENSE in the product package</footer>
</body>
</html>`);
});

app.get('/status', (_req, res) => {
  res.json(bridgeStatus());
});

app.get('/discover', async (_req, res) => {
  try {
    const result = await discoverAllPrinters();
    logger.info(`Discovered ${result.devices.length} printers`);
    // Persist discovered printers into config for survival across restarts.
    for (const device of result.devices) {
      upsertStoredPrinter(deviceToStored(device));
    }
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed';
    logger.error('Printer discovery failed', { error: message });
    res.json({ networks: [], devices: [], source: 'local-bridge', warning: message });
  }
});

app.get('/queues', async (_req, res, next) => {
  try {
    const queues = await listQueues();
    res.json({ ok: true, queues });
  } catch (error) {
    next(error);
  }
});

app.get('/queues/:name', async (req, res, next) => {
  try {
    const queue = await getQueue(req.params.name);
    if (!queue) {
      res.status(404).json({ ok: false, message: `Queue not found: ${req.params.name}` });
      return;
    }
    res.json({ ok: true, queue });
  } catch (error) {
    next(error);
  }
});

app.get('/queues/:name/jobs', async (req, res, next) => {
  try {
    const jobs = await listQueueJobs(req.params.name);
    res.json({ ok: true, queue: req.params.name, jobs, pending_count: jobs.length });
  } catch (error) {
    next(error);
  }
});

app.get('/queues/:name/jobs/:jobId', async (req, res, next) => {
  try {
    const job = await getQueueJob(req.params.name, req.params.jobId);
    if (!job) {
      res.status(404).json({
        ok: false,
        printed: true,
        message: 'Job not in queue (already printed or cancelled)',
        os_job_id: req.params.jobId,
      });
      return;
    }
    res.json({ ok: true, printed: false, job });
  } catch (error) {
    next(error);
  }
});

app.delete('/queues/:name/jobs/:jobId', async (req, res, next) => {
  try {
    await cancelQueueJob(req.params.name, req.params.jobId);
    res.json({
      ok: true,
      cancelled: true,
      queue: req.params.name,
      os_job_id: req.params.jobId,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/print', async (req, res, next) => {
  try {
    const body = req.body as PrintJobRequest;
    const { status, body: responseBody } = await handlePrint(body, 'raw', body.device_id);
    res.status(status).json(responseBody);
  } catch (error) {
    next(error);
  }
});

/* ─── Agent API aliases ─── */

app.get('/health', (_req, res) => {
  res.json(healthStatus());
});

app.get('/version', (_req, res) => {
  res.json({ version: BRIDGE_VERSION });
});

app.get('/printers', async (_req, res, next) => {
  try {
    const result = await discoverAllPrinters();
    const queues = await listQueues().catch(() => []);
    const queueState = new Map(queues.map((q) => [q.name.toLowerCase(), q.state]));
    const printers = result.devices.map((device) => {
      const api = toApiPrinter(device);
      if (device.queue) {
        api.status = queueState.get(device.queue.toLowerCase()) || 'unknown';
      } else if (device.host) {
        api.status = 'online';
      }
      return api;
    });
    res.json(printers);
  } catch (error) {
    next(error);
  }
});

app.post('/printers/discover', async (_req, res, next) => {
  try {
    const result = await discoverAllPrinters();
    for (const device of result.devices) {
      upsertStoredPrinter(deviceToStored(device));
    }
    logger.info(`Discovered ${result.devices.length} printers`);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/printers/:id', async (req, res, next) => {
  try {
    const id = normalizePrinterId(req.params.id);
    const device = await findPrinter(id);
    if (!device) {
      res.status(404).json({ ok: false, message: `Printer not found: ${id}` });
      return;
    }
    res.json(toApiPrinter(device));
  } catch (error) {
    next(error);
  }
});

app.get('/printers/:id/status', async (req, res, next) => {
  try {
    const id = normalizePrinterId(req.params.id);
    const device = await findPrinter(id);
    if (!device) {
      res.status(404).json({ ok: false, message: `Printer not found: ${id}` });
      return;
    }
    let status = 'unknown';
    let detail: string | undefined;
    if (device.queue) {
      const queue = await getQueue(device.queue);
      status = queue?.state || 'unknown';
      detail = queue?.detail;
    } else if (device.host) {
      status = 'online';
    }
    res.json({
      id: device.id,
      name: device.name,
      status,
      detail,
      connectionType: device.connection_type,
      host: device.host,
      port: device.port,
      queue: device.queue,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/printers/:id/test-print', async (req, res, next) => {
  try {
    const id = normalizePrinterId(req.params.id);
    const device = await findPrinter(id);
    if (!device) {
      res.status(404).json({ ok: false, message: `Printer not found: ${id}` });
      return;
    }
    const body = deviceToPrintPayload(device, {
      text: typeof req.body?.text === 'string' ? req.body.text : testPrintText(),
    });
    const { status, body: responseBody } = await handlePrint(body, 'test', device.id);
    res.status(status).json(responseBody);
  } catch (error) {
    next(error);
  }
});

app.post('/print/kot', async (req, res, next) => {
  try {
    const body = req.body as PrintJobRequest;
    const { status, body: responseBody } = await handlePrint(body, 'kot', body.device_id);
    res.status(status).json(responseBody);
  } catch (error) {
    next(error);
  }
});

app.post('/print/bill', async (req, res, next) => {
  try {
    const body = req.body as PrintJobRequest;
    const { status, body: responseBody } = await handlePrint(body, 'bill', body.device_id);
    res.status(status).json(responseBody);
  } catch (error) {
    next(error);
  }
});

app.get('/jobs', (_req, res) => {
  res.json({ ok: true, jobs: jobQueue.list() });
});

app.get('/jobs/:id', (req, res) => {
  const job = jobQueue.get(req.params.id);
  if (!job) {
    res.status(404).json({ ok: false, message: `Job not found: ${req.params.id}` });
    return;
  }
  res.json({ ok: true, job });
});

app.post('/jobs/:id/retry', (req, res, next) => {
  try {
    const job = jobQueue.retry(req.params.id);
    res.json({ ok: true, job });
  } catch (error) {
    next(error);
  }
});

app.post('/jobs/:id/cancel', (req, res, next) => {
  try {
    const job = jobQueue.cancel(req.params.id);
    res.json({ ok: true, job });
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error('Request failed', { error: error.message });
    res.status(400).json({
      ok: false,
      printed: false,
      status: 'failed',
      message: error.message || 'Request failed',
    });
  },
);

let server: Server | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Printer Agent stopping (${signal})`);
  jobQueue.stopAccepting();
  try {
    await jobQueue.drain(30_000);
  } catch (error) {
    logger.error('Queue drain error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    setTimeout(() => resolve(), 5000);
  });
  logger.info('Printer Agent stopped');
  logger.flush();
  process.exit(0);
}

function start(): void {
  const host = getHost();
  const port = getPort();

  // Safety: warn if binding publicly
  if (host === '0.0.0.0' || host === '::') {
    logger.warn('Agent is binding to a public interface — prefer 127.0.0.1');
  }

  server = app.listen(port, host, () => {
    const status = bridgeStatus();
    logger.info(`Printer Agent started v${status.version}`, {
      url: `http://${host}:${port}`,
      platform: status.platform,
      environment: status.environment,
    });
    logger.info(
      'Endpoints: GET /health /status /version /discover /printers /queues /jobs  POST /print',
    );
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    logger.error('HTTP server error', { error: error.message, code: error.code });
    process.exit(1);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
if (process.platform === 'win32') {
  process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
}
process.on('uncaughtException', (error) => {
  logger.error('Unexpected exception', { error: error.message, stack: error.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

start();
