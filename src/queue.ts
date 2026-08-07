import { PRINT_CONFIRM_POLL_MS, PRINT_CONFIRM_TIMEOUT_MS } from './config.js';
import { execFileHidden, powershellHiddenArgs } from './exec.js';

export type PrinterQueueState = 'online' | 'offline' | 'paused' | 'error' | 'unknown';

export type OsPrintJob = {
  os_job_id: string;
  queue: string;
  title?: string;
  state: string;
  size?: number;
  submitted_at?: string | null;
};

export type QueueInfo = {
  name: string;
  state: PrinterQueueState;
  detail?: string;
  pending_count: number;
  jobs: OsPrintJob[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeQueueName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '');
}

function queueNamesMatch(a: string, b: string): boolean {
  return normalizeQueueName(a) === normalizeQueueName(b);
}

/* ─── CUPS (macOS / Linux) ─── */

function parseCupsJobId(stdout: string): string | null {
  const match = stdout.match(/request id is\s+(\S+)/i);
  return match?.[1]?.replace(/[.,;]+$/, '') || null;
}

async function cupsPrinterState(queue: string): Promise<{ state: PrinterQueueState; detail: string }> {
  try {
    const { stdout } = await execFileHidden('lpstat', ['-p', queue], { timeout: 8000 });
    const text = stdout.trim();
    const lower = text.toLowerCase();
    if (lower.includes('disabled') || lower.includes('offline')) {
      return { state: 'offline', detail: text };
    }
    if (lower.includes('paused') || lower.includes('stopped')) {
      return { state: 'paused', detail: text };
    }
    if (lower.includes('idle') || lower.includes('printing') || lower.includes('enabled')) {
      return { state: 'online', detail: text };
    }
    return { state: 'unknown', detail: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: 'error', detail: message };
  }
}

async function cupsListJobs(queue?: string): Promise<OsPrintJob[]> {
  try {
    const args = queue ? ['-o', queue] : ['-o'];
    const { stdout } = await execFileHidden('lpstat', args, { timeout: 8000 });
    const jobs: OsPrintJob[] = [];
    for (const line of stdout.split('\n')) {
      // e.g. GP-C80250I_Plus-42 user 1234 Wed 01 Aug 2024 03:00:00 PM IST
      const match = line.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(.+)$/);
      if (!match) continue;
      const osJobId = match[1];
      const queueName = osJobId.replace(/-\d+$/, '');
      jobs.push({
        os_job_id: osJobId,
        queue: queue || queueName,
        title: match[2],
        state: 'pending',
        size: Number(match[3]) || undefined,
        submitted_at: match[4]?.trim() || null,
      });
    }
    return jobs;
  } catch {
    return [];
  }
}

async function cupsListQueues(): Promise<QueueInfo[]> {
  const names = new Set<string>();
  try {
    const { stdout } = await execFileHidden('lpstat', ['-a'], { timeout: 8000 });
    for (const line of stdout.split('\n')) {
      const name = line.trim().split(/\s+/)[0];
      if (name) names.add(name);
    }
  } catch {
    /* ignore */
  }
  try {
    const { stdout } = await execFileHidden('lpstat', ['-v'], { timeout: 8000 });
    for (const line of stdout.split('\n')) {
      const match = line.match(/^device for (.+):/i);
      if (match?.[1]) names.add(match[1].trim());
    }
  } catch {
    /* ignore */
  }

  const queues: QueueInfo[] = [];
  for (const name of [...names].sort()) {
    const { state, detail } = await cupsPrinterState(name);
    const jobs = await cupsListJobs(name);
    queues.push({
      name,
      state,
      detail,
      pending_count: jobs.length,
      jobs,
    });
  }
  return queues;
}

async function cupsCancelJob(osJobId: string): Promise<void> {
  await execFileHidden('cancel', [osJobId], { timeout: 8000 });
}

async function cupsJobStillPending(osJobId: string, queue: string): Promise<boolean> {
  const jobs = await cupsListJobs(queue);
  if (jobs.some((j) => j.os_job_id === osJobId)) return true;
  // Also check all jobs in case queue name differs slightly
  const all = await cupsListJobs();
  return all.some((j) => j.os_job_id === osJobId);
}

/* ─── Windows ─── */

async function windowsPrinterState(queue: string): Promise<{ state: PrinterQueueState; detail: string }> {
  const script = `
$ErrorActionPreference = 'Stop'
$p = Get-Printer -Name ${JSON.stringify(queue)} -ErrorAction Stop
$state = 'online'
$detail = [string]$p.PrinterStatus
if ($p.PrinterStatus -match 'Offline|Error|NotAvailable') { $state = 'offline' }
elseif ($p.PrinterStatus -match 'Paused') { $state = 'paused' }
elseif ($p.WorkOffline) { $state = 'offline' }
@{ state = $state; detail = $detail } | ConvertTo-Json -Compress
`;
  try {
    const { stdout } = await execFileHidden(
      'powershell',
      powershellHiddenArgs(['-Command', script]),
      { timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim() || '{}') as { state?: string; detail?: string };
    const state = (parsed.state as PrinterQueueState) || 'unknown';
    return { state, detail: parsed.detail || '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: 'error', detail: message };
  }
}

async function windowsListJobs(queue: string): Promise<OsPrintJob[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Get-PrintJob -PrinterName ${JSON.stringify(queue)} | ForEach-Object {
  [PSCustomObject]@{
    os_job_id = [string]$_.Id
    queue = ${JSON.stringify(queue)}
    title = $_.DocumentName
    state = [string]$_.JobStatus
    size = $_.Size
    submitted_at = if ($_.SubmittedTime) { $_.SubmittedTime.ToString('o') } else { $null }
  }
} | ConvertTo-Json -Compress
`;
  try {
    const { stdout } = await execFileHidden(
      'powershell',
      powershellHiddenArgs(['-Command', script]),
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed) as OsPrintJob | OsPrintJob[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function windowsListQueues(): Promise<QueueInfo[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Get-Printer | ForEach-Object {
  $jobs = @(Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue)
  $state = 'online'
  if ($_.WorkOffline -or $_.PrinterStatus -match 'Offline|Error|NotAvailable') { $state = 'offline' }
  elseif ($_.PrinterStatus -match 'Paused') { $state = 'paused' }
  [PSCustomObject]@{
    name = $_.Name
    state = $state
    detail = [string]$_.PrinterStatus
    pending_count = $jobs.Count
    jobs = @($jobs | ForEach-Object {
      [PSCustomObject]@{
        os_job_id = [string]$_.Id
        queue = $_.PrinterName
        title = $_.DocumentName
        state = [string]$_.JobStatus
        size = $_.Size
        submitted_at = if ($_.SubmittedTime) { $_.SubmittedTime.ToString('o') } else { $null }
      }
    })
  }
} | ConvertTo-Json -Compress -Depth 5
`;
  try {
    const { stdout } = await execFileHidden(
      'powershell',
      powershellHiddenArgs(['-Command', script]),
      { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed) as QueueInfo | QueueInfo[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function windowsCancelJob(queue: string, osJobId: string): Promise<void> {
  const script = `
$ErrorActionPreference = 'Stop'
Remove-PrintJob -PrinterName ${JSON.stringify(queue)} -ID ${Number(osJobId)}
`;
  await execFileHidden(
    'powershell',
    powershellHiddenArgs(['-Command', script]),
    { timeout: 15000 },
  );
}

async function windowsJobStillPending(queue: string, osJobId: string): Promise<boolean> {
  const jobs = await windowsListJobs(queue);
  return jobs.some((j) => String(j.os_job_id) === String(osJobId));
}

/* ─── Public API ─── */

export async function listQueues(): Promise<QueueInfo[]> {
  if (process.platform === 'win32') return windowsListQueues();
  return cupsListQueues();
}

export async function getQueue(queue: string): Promise<QueueInfo | null> {
  const queues = await listQueues();
  return queues.find((q) => queueNamesMatch(q.name, queue)) || null;
}

export async function listQueueJobs(queue: string): Promise<OsPrintJob[]> {
  if (process.platform === 'win32') return windowsListJobs(queue);
  return cupsListJobs(queue);
}

export async function getQueueJob(queue: string, osJobId: string): Promise<OsPrintJob | null> {
  const jobs = await listQueueJobs(queue);
  return jobs.find((j) => String(j.os_job_id) === String(osJobId)) || null;
}

export async function cancelQueueJob(queue: string, osJobId: string): Promise<void> {
  if (process.platform === 'win32') {
    await windowsCancelJob(queue, osJobId);
    return;
  }
  await cupsCancelJob(osJobId);
}

export function parseCupsSubmitJobId(stdout: string): string | null {
  return parseCupsJobId(stdout);
}

export type ConfirmPrintResult = {
  printed: boolean;
  status: 'printed' | 'failed';
  message: string;
  os_job_id?: string | null;
  queue_jobs?: number;
  printer_state?: PrinterQueueState;
};

/**
 * Wait until OS job leaves the queue (printed) or timeout / offline.
 * On failure, cancels the OS job so reconnect does not dump a backlog.
 */
export async function confirmQueuePrint(args: {
  queue: string;
  osJobId?: string | null;
  timeoutMs?: number;
}): Promise<ConfirmPrintResult> {
  const timeoutMs = args.timeoutMs ?? PRINT_CONFIRM_TIMEOUT_MS;
  const started = Date.now();
  const queue = args.queue;
  let osJobId = args.osJobId || null;

  // If submit was so fast we missed the id, try to match newest pending job briefly.
  if (!osJobId) {
    for (let i = 0; i < 6; i++) {
      const jobs = await listQueueJobs(queue);
      if (jobs.length) {
        osJobId = jobs[jobs.length - 1]?.os_job_id || jobs[0]?.os_job_id || null;
        break;
      }
      const { state } = process.platform === 'win32'
        ? await windowsPrinterState(queue)
        : await cupsPrinterState(queue);
      if (state === 'offline' || state === 'error') {
        return {
          printed: false,
          status: 'failed',
          message: `Printer offline or error — job not printed (${state})`,
          os_job_id: null,
          queue_jobs: jobs.length,
          printer_state: state,
        };
      }
      // No job in queue and printer online → likely already finished
      if (i >= 2 && state === 'online') {
        return {
          printed: true,
          status: 'printed',
          message: 'Printed successfully',
          os_job_id: null,
          queue_jobs: 0,
          printer_state: state,
        };
      }
      await sleep(PRINT_CONFIRM_POLL_MS);
    }
  }

  if (!osJobId) {
    const info = await getQueue(queue);
    if (info?.state === 'offline' || info?.state === 'error') {
      return {
        printed: false,
        status: 'failed',
        message: 'Printer offline — could not confirm print job',
        os_job_id: null,
        queue_jobs: info.pending_count,
        printer_state: info.state,
      };
    }
    // Accepted with no visible job id and printer looks fine
    return {
      printed: true,
      status: 'printed',
      message: 'Printed successfully',
      os_job_id: null,
      queue_jobs: info?.pending_count ?? 0,
      printer_state: info?.state,
    };
  }

  while (Date.now() - started < timeoutMs) {
    const stillPending =
      process.platform === 'win32'
        ? await windowsJobStillPending(queue, osJobId)
        : await cupsJobStillPending(osJobId, queue);

    if (!stillPending) {
      const { state } = process.platform === 'win32'
        ? await windowsPrinterState(queue)
        : await cupsPrinterState(queue);
      return {
        printed: true,
        status: 'printed',
        message: 'Printed successfully',
        os_job_id: osJobId,
        queue_jobs: 0,
        printer_state: state,
      };
    }

    const { state, detail } =
      process.platform === 'win32'
        ? await windowsPrinterState(queue)
        : await cupsPrinterState(queue);

    if (state === 'offline' || state === 'error' || state === 'paused') {
      try {
        await cancelQueueJob(queue, osJobId);
      } catch {
        /* best effort */
      }
      const jobs = await listQueueJobs(queue);
      return {
        printed: false,
        status: 'failed',
        message:
          state === 'paused'
            ? `Printer paused — job cancelled from system queue (${detail || state})`
            : `Printer ${state} — job cancelled from system queue so it will not print later`,
        os_job_id: osJobId,
        queue_jobs: jobs.length,
        printer_state: state,
      };
    }

    await sleep(PRINT_CONFIRM_POLL_MS);
  }

  // Timed out while still in queue — cancel to avoid backlog dump
  try {
    await cancelQueueJob(queue, osJobId);
  } catch {
    /* best effort */
  }
  const jobs = await listQueueJobs(queue);
  const { state } =
    process.platform === 'win32'
      ? await windowsPrinterState(queue)
      : await cupsPrinterState(queue);

  return {
    printed: false,
    status: 'failed',
    message:
      `Print not confirmed in ${Math.round(timeoutMs / 1000)}s — job removed from system queue (printer slow/offline)`,
    os_job_id: osJobId,
    queue_jobs: jobs.length,
    printer_state: state,
  };
}
