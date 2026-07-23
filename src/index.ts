#!/usr/bin/env node
import cors from 'cors';
import express from 'express';
import { bridgeStatus, DEFAULT_PORT, HOST } from './config.js';
import { discoverNetworkPrinters } from './discover.js';
import { sendRawPrint, type PrintJobRequest } from './print.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/status', (_req, res) => {
  res.json(bridgeStatus());
});

app.get('/discover', async (_req, res, next) => {
  try {
    const result = await discoverNetworkPrinters();
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed';
    res.json({ networks: [], devices: [], source: 'local-bridge', warning: message });
  }
});

app.post('/print', async (req, res, next) => {
  try {
    const body = req.body as PrintJobRequest;
    const result = await sendRawPrint(body);
    res.json(result);
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
    res.status(400).json({ ok: false, message: error.message || 'Request failed' });
  },
);

app.listen(DEFAULT_PORT, HOST, () => {
  const status = bridgeStatus();
  console.log(
    `[pos-print-bridge] v${status.version} listening on http://${HOST}:${DEFAULT_PORT} (${status.platform})`,
  );
  console.log('[pos-print-bridge] Endpoints: GET /status  GET /discover  POST /print');
});
