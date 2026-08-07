import * as os from 'node:os';
import { execFileHidden, powershellHiddenArgs } from './exec.js';

export type PrinterLinkKind = 'network' | 'wifi' | 'usb' | 'bluetooth' | 'local';
export type BackendConnectionType = 'network' | 'usb' | 'bluetooth';

export interface SystemPrinterDevice {
  id: string;
  name: string;
  kind: PrinterLinkKind;
  connection_type: BackendConnectionType;
  host?: string;
  port?: number;
  queue?: string;
  uri?: string;
  protocol?: string;
  detail?: string;
}

const KIND_LABEL: Record<PrinterLinkKind, string> = {
  network: 'LAN',
  wifi: 'Wi‑Fi',
  usb: 'USB',
  bluetooth: 'Bluetooth',
  local: 'Local',
};

export function deviceLabel(device: SystemPrinterDevice): string {
  const kind = KIND_LABEL[device.kind] || device.kind;
  const detail = device.detail || device.host || device.queue || '';
  return detail ? `${device.name} · ${kind} · ${detail}` : `${device.name} · ${kind}`;
}

function classifyUri(uri: string): PrinterLinkKind {
  const lower = uri.toLowerCase();
  if (lower.startsWith('usb://') || lower.includes('/usb')) return 'usb';
  if (lower.startsWith('bluetooth://') || lower.includes('bluetooth')) return 'bluetooth';
  if (lower.startsWith('dnssd://') || lower.includes('ipps?') || lower.includes('_ipp._tcp'))
    return 'wifi';
  if (
    lower.startsWith('socket://') ||
    lower.startsWith('ipp://') ||
    lower.startsWith('ipps://') ||
    lower.startsWith('lpd://') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://')
  ) {
    return 'network';
  }
  return 'local';
}

function connectionTypeForKind(kind: PrinterLinkKind): BackendConnectionType {
  if (kind === 'bluetooth') return 'bluetooth';
  if (kind === 'network' || kind === 'wifi') return 'network';
  return 'usb';
}

function parseHostPort(uri: string): { host?: string; port?: number; protocol?: string } {
  try {
    const normalized = uri.replace(/^socket:\/\//, 'tcp://').replace(/^lpd:\/\//, 'lpd://');
    const url = new URL(normalized.includes('://') ? normalized : `socket://${normalized}`);
    const host = url.hostname || undefined;
    const port = url.port ? Number(url.port) : undefined;
    const protocol = url.protocol.replace(':', '').replace('socket', 'raw');
    return { host, port, protocol };
  } catch {
    const ipMatch = uri.match(/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?/);
    if (!ipMatch) return {};
    return {
      host: ipMatch[1],
      port: ipMatch[2] ? Number(ipMatch[2]) : 9100,
      protocol: 'raw',
    };
  }
}

async function discoverCupsPrinters(): Promise<SystemPrinterDevice[]> {
  if (process.platform === 'win32') return discoverWindowsPrinters();

  let stdout = '';
  try {
    const result = await execFileHidden('lpstat', ['-v'], { timeout: 8000 });
    stdout = result.stdout || '';
  } catch {
    return [];
  }

  const devices: SystemPrinterDevice[] = [];
  const lines = stdout.split('\n');
  for (const line of lines) {
    const match = line.match(/^device for ([^:]+):\s*(.+)$/i);
    if (!match) continue;
    const queue = match[1].trim();
    const uri = match[2].trim();
    const kind = classifyUri(uri);
    const { host, port, protocol } = parseHostPort(uri);
    const isDirect = kind === 'usb' || kind === 'bluetooth' || kind === 'local';
    devices.push({
      id: `system:${queue}`,
      name: queue,
      kind,
      connection_type: connectionTypeForKind(kind),
      queue,
      uri,
      host: isDirect ? undefined : host,
      port: isDirect ? undefined : port,
      protocol,
      detail: isDirect
        ? kind === 'usb'
          ? 'USB connected'
          : kind === 'bluetooth'
            ? 'Bluetooth'
            : 'Installed'
        : host
          ? `${host}${port ? `:${port}` : ''}`
          : uri.split('://')[0],
    });
  }

  return devices;
}

interface WindowsPrinterRow {
  Name?: string;
  PortName?: string;
  Network?: boolean;
  Local?: boolean;
}

function classifyWindowsPort(portName: string, network?: boolean): PrinterLinkKind {
  const port = portName || '';
  if (/^IP_/i.test(port) || /\d{1,3}(?:\.\d{1,3}){3}/.test(port)) return network ? 'wifi' : 'network';
  if (/^WSD-/i.test(port)) return 'wifi';
  if (/^USB/i.test(port)) return 'usb';
  if (/BTH|Bluetooth/i.test(port)) return 'bluetooth';
  if (/^COM|^LPT/i.test(port)) return 'local';
  return network ? 'wifi' : 'local';
}

function parseWindowsPort(portName: string): { host?: string; port?: number } {
  const ipInPort = portName.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  if (ipInPort) return { host: ipInPort[1], port: 9100 };
  const ipPrefix = portName.match(/^IP_(\d{1,3}(?:\.\d{1,3}){3})(?:_(\d+))?/i);
  if (ipPrefix) {
    return { host: ipPrefix[1], port: ipPrefix[2] ? Number(ipPrefix[2]) : 9100 };
  }
  return {};
}

async function discoverWindowsPrinters(): Promise<SystemPrinterDevice[]> {
  try {
    const script =
      'Get-CimInstance Win32_Printer | Select-Object Name,PortName,Network,Local | ConvertTo-Json -Compress';
    const result = await execFileHidden(
      'powershell',
      powershellHiddenArgs(['-Command', script]),
      { timeout: 12000, maxBuffer: 4 * 1024 * 1024 },
    );
    const raw = (result.stdout || '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WindowsPrinterRow | WindowsPrinterRow[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter((row) => row.Name)
      .map((row) => {
        const portName = row.PortName || '';
        const kind = classifyWindowsPort(portName, row.Network);
        const { host, port } = parseWindowsPort(portName);
        return {
          id: `system:${row.Name}`,
          name: row.Name!,
          kind,
          connection_type: connectionTypeForKind(kind),
          queue: row.Name!,
          host,
          port,
          detail: host ? `${host}${port ? `:${port}` : ''}` : portName || 'Installed',
        } satisfies SystemPrinterDevice;
      });
  } catch {
    return [];
  }
}

export async function discoverSystemPrinters(): Promise<SystemPrinterDevice[]> {
  const cups = await discoverCupsPrinters();
  if (cups.length) return cups;

  // Fallback when lpstat is empty but OS lists printers differently.
  if (process.platform === 'darwin') {
    try {
      const result = await execFileHidden('lpstat', ['-a'], { timeout: 5000 });
      return (result.stdout || '')
        .split('\n')
        .map((line) => line.match(/^(\S+)\s/)?.[1])
        .filter(Boolean)
        .map((queue) => ({
          id: `system:${queue}`,
          name: queue!,
          kind: 'local' as const,
          connection_type: 'usb' as const,
          queue: queue!,
          detail: 'Installed',
        }));
    } catch {
      return [];
    }
  }

  return [];
}

export function platformLabel(): string {
  return `${os.platform()} ${os.release()}`;
}
