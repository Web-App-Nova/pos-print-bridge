import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  PrintConfirmError,
  sendPrintJob,
  type PrintJobRequest,
  type PrintJobResult,
} from './print.js';
import { getJobsPath, ensureAppDirs } from './paths.js';
import { getConfig } from './store.js';
import { logger } from './logger.js';

export type JobStatus =
  | 'QUEUED'
  | 'PRINTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRY'
  | 'CANCELLED';

export type JobType = 'raw' | 'kot' | 'bill' | 'test';

export interface AgentPrintJob {
  jobId: string;
  printerId: string;
  jobType: JobType;
  payload: PrintJobRequest;
  status: JobStatus;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  retryCount: number;
  error?: string | null;
  result?: PrintJobResult | null;
}

type Waiter = {
  resolve: (result: PrintJobResult) => void;
  reject: (error: Error) => void;
};

function printerKey(payload: PrintJobRequest): string {
  if (payload.queue?.trim()) return `queue:${payload.queue.trim().toLowerCase()}`;
  if (payload.device_id?.startsWith('system:')) {
    return `queue:${payload.device_id.slice('system:'.length).trim().toLowerCase()}`;
  }
  if (payload.host?.trim()) {
    return `host:${payload.host.trim()}:${Number(payload.port || 9100)}`;
  }
  if (payload.device_id?.trim()) return `id:${payload.device_id.trim()}`;
  return 'unknown';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnrefused') ||
    lower.includes('ehostunreach') ||
    lower.includes('enetunreach') ||
    lower.includes('offline') ||
    lower.includes('not available') ||
    lower.includes('network') ||
    lower.includes('could not confirm')
  );
}

class PrintJobQueue {
  private jobs = new Map<string, AgentPrintJob>();
  private waiters = new Map<string, Waiter>();
  private activeTargets = new Set<string>();
  private accepting = true;
  private draining = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpScheduled = false;

  start(): void {
    this.load();
    // Recover interrupted PRINTING/RETRY jobs as QUEUED
    for (const job of this.jobs.values()) {
      if (job.status === 'PRINTING' || job.status === 'RETRY') {
        job.status = 'QUEUED';
        job.startedAt = null;
        logger.info('Recovered pending print job', { jobId: job.jobId });
      }
    }
    this.persistSoon();
    this.schedulePump();
    logger.info('Print job queue started', { jobs: this.jobs.size });
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  async drain(timeoutMs = 30_000): Promise<void> {
    this.draining = true;
    this.stopAccepting();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const busy =
        this.activeTargets.size > 0 ||
        [...this.jobs.values()].some((j) => j.status === 'QUEUED' || j.status === 'RETRY');
      if (!busy) break;
      this.schedulePump();
      await sleep(100);
    }
    this.persistNow();
    logger.info('Print job queue drained');
  }

  list(limit = 100): AgentPrintJob[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  get(jobId: string): AgentPrintJob | undefined {
    return this.jobs.get(jobId);
  }

  async enqueueAndWait(
    payload: PrintJobRequest,
    jobType: JobType = 'raw',
    printerId?: string,
  ): Promise<PrintJobResult> {
    if (!this.accepting) {
      throw new Error('Printer agent is shutting down — not accepting new jobs');
    }
    this.validatePayload(payload);

    const job = this.createJob(payload, jobType, printerId);
    logger.info('Print job created', { jobId: job.jobId, jobType, printerId: job.printerId });

    return new Promise<PrintJobResult>((resolve, reject) => {
      this.waiters.set(job.jobId, { resolve, reject });
      this.schedulePump();
    });
  }

  enqueue(
    payload: PrintJobRequest,
    jobType: JobType = 'raw',
    printerId?: string,
  ): AgentPrintJob {
    if (!this.accepting) {
      throw new Error('Printer agent is shutting down — not accepting new jobs');
    }
    this.validatePayload(payload);
    const job = this.createJob(payload, jobType, printerId);
    logger.info('Print job created', { jobId: job.jobId, jobType, printerId: job.printerId });
    this.schedulePump();
    return job;
  }

  retry(jobId: string): AgentPrintJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status === 'PRINTING') throw new Error('Job is currently printing');
    if (job.status === 'QUEUED' || job.status === 'RETRY') {
      return job;
    }
    if (job.status !== 'FAILED') {
      throw new Error(`Only failed jobs can be retried (status=${job.status})`);
    }
    if (
      job.payload.data_base64 === '[omitted]' ||
      (!job.payload.text && !job.payload.data_base64)
    ) {
      throw new Error('Job payload no longer available for retry');
    }
    if (!this.accepting) {
      throw new Error('Printer agent is shutting down — not accepting retries');
    }
    job.status = 'QUEUED';
    job.error = null;
    job.completedAt = null;
    job.result = null;
    this.persistSoon();
    this.schedulePump();
    logger.info('Print job retry requested', { jobId });
    return job;
  }

  cancel(jobId: string): AgentPrintJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') return job;
    if (job.status === 'PRINTING') {
      throw new Error('Cannot cancel a job that is currently printing');
    }
    job.status = 'CANCELLED';
    job.completedAt = new Date().toISOString();
    job.error = 'Cancelled';
    const waiter = this.waiters.get(jobId);
    if (waiter) {
      this.waiters.delete(jobId);
      waiter.reject(new Error('Job cancelled'));
    }
    this.persistSoon();
    logger.info('Print job cancelled', { jobId });
    return job;
  }

  private createJob(
    payload: PrintJobRequest,
    jobType: JobType,
    printerId?: string,
  ): AgentPrintJob {
    const id = printerId || payload.device_id || printerKey(payload);
    const job: AgentPrintJob = {
      jobId: `JOB-${randomUUID().slice(0, 8).toUpperCase()}`,
      printerId: id,
      jobType,
      payload,
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      error: null,
      result: null,
    };
    this.jobs.set(job.jobId, job);
    this.trimHistory();
    this.persistSoon();
    return job;
  }

  private validatePayload(payload: PrintJobRequest): void {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid print payload');
    }
    if (payload.text == null && !payload.data_base64) {
      throw new Error('Provide text or data_base64');
    }
    if (payload.data_base64 && typeof payload.data_base64 !== 'string') {
      throw new Error('data_base64 must be a string');
    }
    if (payload.host && typeof payload.host !== 'string') {
      throw new Error('host must be a string');
    }
    if (payload.host) {
      // Prevent obvious SSRF / non-IP nonsense for LAN printers — allow hostnames too but block schemes.
      if (/[\\/]/.test(payload.host) || payload.host.includes('://')) {
        throw new Error('Invalid printer host');
      }
    }
    if (payload.port != null) {
      const port = Number(payload.port);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new Error('Invalid printer port');
      }
    }
    if (
      !payload.host &&
      !payload.queue &&
      !payload.device_id &&
      !payload.uri
    ) {
      throw new Error('Select a printer (host, queue, or device_id) before printing');
    }
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    setImmediate(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    const queued = [...this.jobs.values()]
      .filter((j) => j.status === 'QUEUED' || j.status === 'RETRY')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const started: Promise<void>[] = [];
    for (const job of queued) {
      const target = printerKey(job.payload);
      if (this.activeTargets.has(target)) continue;
      this.activeTargets.add(target);
      started.push(this.runJob(job, target));
    }
    if (started.length) await Promise.all(started);
  }

  private async runJob(job: AgentPrintJob, target: string): Promise<void> {
    const cfg = getConfig();
    const maxRetries = cfg.maxRetries ?? 2;
    const retryDelay = cfg.retryDelayMs ?? 1500;

    job.status = 'PRINTING';
    job.startedAt = new Date().toISOString();
    this.persistSoon();
    logger.info('Printing job', { jobId: job.jobId, target });

    try {
      const result = await sendPrintJob(job.payload);
      job.status = 'COMPLETED';
      job.completedAt = new Date().toISOString();
      job.result = result;
      job.error = null;
      logger.info('Print job completed', { jobId: job.jobId });
      const waiter = this.waiters.get(job.jobId);
      if (waiter) {
        this.waiters.delete(job.jobId);
        waiter.resolve(result);
      }
    } catch (error) {
      let result: PrintJobResult | null = null;
      let message = error instanceof Error ? error.message : String(error);
      if (error instanceof PrintConfirmError) {
        result = error.result;
        message = error.result.message;
      }

      const canRetry = job.retryCount < maxRetries && isRetryable(message);
      if (canRetry) {
        job.retryCount += 1;
        job.status = 'RETRY';
        job.error = message;
        job.result = result;
        logger.warn('Print job failed — retrying', {
          jobId: job.jobId,
          retryCount: job.retryCount,
          error: message,
        });
        this.persistSoon();
        this.activeTargets.delete(target);
        await sleep(retryDelay);
        // Re-queue
        job.status = 'QUEUED';
        this.persistSoon();
        this.schedulePump();
        return;
      }

      job.status = 'FAILED';
      job.completedAt = new Date().toISOString();
      job.error = message;
      job.result = result;
      logger.error('Print job failed', { jobId: job.jobId, error: message });
      const waiter = this.waiters.get(job.jobId);
      if (waiter) {
        this.waiters.delete(job.jobId);
        if (error instanceof PrintConfirmError) waiter.reject(error);
        else waiter.reject(error instanceof Error ? error : new Error(message));
      }
    } finally {
      this.activeTargets.delete(target);
      this.persistSoon();
      this.schedulePump();
    }
  }

  private trimHistory(): void {
    const kept = this.list(500);
    if (kept.length < this.jobs.size) {
      this.jobs = new Map(kept.map((j) => [j.jobId, j]));
    }
  }

  private load(): void {
    ensureAppDirs();
    const path = getJobsPath();
    if (!existsSync(path)) return;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { jobs?: AgentPrintJob[] };
      for (const job of raw.jobs || []) {
        if (job?.jobId) this.jobs.set(job.jobId, job);
      }
    } catch (error) {
      logger.error('Failed to load persisted jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private persistSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 200);
  }

  private persistNow(): void {
    ensureAppDirs();
    const path = getJobsPath();
    // Persist active + recent terminal jobs (not huge history of payloads forever)
    const jobs = this.list(200).map((j) => ({
      ...j,
      // Avoid bloating disk with huge base64 on completed jobs older than keep — keep payload for retry.
      payload:
        j.status === 'COMPLETED' && j.completedAt
          ? { ...j.payload, data_base64: j.payload.data_base64 ? '[omitted]' : undefined }
          : j.payload,
    }));
    try {
      writeFileSync(path, `${JSON.stringify({ jobs }, null, 2)}\n`, 'utf8');
    } catch (error) {
      logger.error('Failed to persist jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const jobQueue = new PrintJobQueue();
