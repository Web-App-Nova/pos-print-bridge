#!/usr/bin/env node
import cors from 'cors';
import express from 'express';
import type { Server } from 'node:http';
import { bridgeStatus, DEFAULT_PORT, HOST } from './config.js';
import { discoverAllPrinters } from './discover-all.js';
import { PrintConfirmError, sendPrintJob, type PrintJobRequest } from './print.js';
import {
  cancelQueueJob,
  getQueue,
  getQueueJob,
  listQueueJobs,
  listQueues,
} from './queue.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/status', (_req, res) => {
    res.json(bridgeStatus());
  });

  app.get('/discover', async (_req, res) => {
    try {
      const result = await discoverAllPrinters();
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Discovery failed';
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
      const result = await sendPrintJob(body);
      res.json(result);
    } catch (error) {
      if (error instanceof PrintConfirmError) {
        res.status(422).json(error.result);
        return;
      }
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
      res.status(400).json({
        ok: false,
        printed: false,
        status: 'failed',
        message: error.message || 'Request failed',
      });
    },
  );

  return app;
}

export type StartServerOptions = {
  host?: string;
  port?: number;
  quiet?: boolean;
};

/** Start the local print bridge HTTP server (used by npm start and packaged binaries). */
export function startServer(options: StartServerOptions = {}): Server {
  const host = options.host ?? HOST;
  const port = options.port ?? DEFAULT_PORT;
  const app = createApp();
  const server = app.listen(port, host, () => {
    if (options.quiet) return;
    const status = bridgeStatus();
    console.log(
      `[pos-print-bridge] v${status.version} listening on http://${host}:${port} (${status.platform})`,
    );
    console.log(
      '[pos-print-bridge] Endpoints: GET /status  GET /discover  GET /queues  POST /print',
    );
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[pos-print-bridge] Port ${port} already in use — another bridge may be running.`,
      );
      process.exit(1);
    }
    throw error;
  });
  return server;
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('index.js') ||
    process.argv[1].endsWith('index.ts') ||
    process.argv[1].includes('pos-print-bridge'));

if (isDirectRun || (process as NodeJS.Process & { pkg?: unknown }).pkg) {
  startServer();
}
