import * as dns from 'dns';
import * as net from 'net';
import * as os from 'os';
import { DISCOVERY_TIMEOUT_MS } from './config.js';

const PRINT_PORTS = [9100, 515, 631] as const;
const MAX_NETWORKS = 4;
const WORKERS = 64;

export interface DiscoveredPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'raw' | 'lpd' | 'ipp';
  open_ports: number[];
}

export interface DiscoveryResult {
  networks: string[];
  devices: DiscoveredPrinter[];
  source: 'local-bridge';
}

const normalizeIp = (value?: string | null) => {
  if (!value) return null;
  const normalized = value.replace(/^::ffff:/, '').split('%')[0];
  return net.isIPv4(normalized) ? normalized : null;
};

const isPrivateIpv4 = (ip: string) => {
  const parts = ip.split('.').map(Number);
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
};

const subnetKey = (ip: string) => ip.split('.').slice(0, 3).join('.');

const canConnect = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(DISCOVERY_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });

async function mapWithConcurrency<T, R>(
  values: T[],
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(WORKERS, values.length || 1) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        output[index] = await worker(values[index]);
      }
    }),
  );
  return output;
}

const protocolForPort = (port: number): DiscoveredPrinter['protocol'] =>
  port === 631 ? 'ipp' : port === 515 ? 'lpd' : 'raw';

/** Scans private /24 networks on this machine (billing PC LAN). */
export async function discoverNetworkPrinters(): Promise<DiscoveryResult> {
  let candidateIps: string[] = [];
  try {
    candidateIps = Object.values(os.networkInterfaces())
      .flat()
      .filter(Boolean)
      .map((entry) => normalizeIp(entry?.address))
      .filter((ip): ip is string => Boolean(ip && isPrivateIpv4(ip)));
  } catch {
    return { networks: [], devices: [], source: 'local-bridge' };
  }

  const networks = [...new Set(candidateIps.map(subnetKey))].slice(0, MAX_NETWORKS);
  const hosts = networks.flatMap((network) =>
    Array.from({ length: 254 }, (_, index) => `${network}.${index + 1}`),
  );

  const discovered = (
    await mapWithConcurrency(hosts, async (host) => {
      const checks = await Promise.all(
        PRINT_PORTS.map(async (port) => ({
          port,
          open: await canConnect(host, port),
        })),
      );
      const openPorts = checks.filter((check) => check.open).map((check) => check.port);
      if (!openPorts.length) return null;

      // IPP/CUPS on 631 accepts TCP but cannot print raw ESC/POS — require RAW 9100 or LPD 515.
      const preferredPort =
        openPorts.find((port) => port === 9100) ||
        openPorts.find((port) => port === 515) ||
        null;
      if (!preferredPort) return null;

      let hostname = '';
      try {
        hostname = (await dns.promises.reverse(host))[0] || '';
      } catch {
        // Reverse DNS is optional.
      }
      return {
        id: `network:${host}`,
        name: hostname || `Network printer ${host}`,
        host,
        port: preferredPort,
        protocol: protocolForPort(preferredPort),
        open_ports: openPorts,
      } satisfies DiscoveredPrinter;
    })
  ).filter(Boolean) as DiscoveredPrinter[];

  return { networks, devices: discovered, source: 'local-bridge' };
}
