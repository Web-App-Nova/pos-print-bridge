import { discoverNetworkPrinters, type DiscoveredPrinter } from './discover.js';
import {
  deviceLabel,
  discoverSystemPrinters,
  type SystemPrinterDevice,
} from './discover-system.js';

export interface UnifiedPrinterDevice extends SystemPrinterDevice {
  label: string;
  source: 'system' | 'network-scan';
}

export interface UnifiedDiscoveryResult {
  networks: string[];
  devices: UnifiedPrinterDevice[];
  source: 'local-bridge';
  platform?: string;
  warning?: string;
}

function networkToUnified(device: DiscoveredPrinter): UnifiedPrinterDevice {
  return {
    id: device.id,
    name: device.name,
    kind: 'network',
    connection_type: 'network',
    host: device.host,
    port: device.port,
    protocol: device.protocol,
    detail: `${device.host}:${device.port}`,
    label: `${device.name} · LAN · ${device.host}:${device.port} · ${device.protocol.toUpperCase()}`,
    source: 'network-scan',
  };
}

function systemToUnified(device: SystemPrinterDevice): UnifiedPrinterDevice {
  return {
    ...device,
    label: deviceLabel(device),
    source: 'system',
  };
}

/** All printers visible to this billing PC: OS-installed + LAN scan. */
export async function discoverAllPrinters(): Promise<UnifiedDiscoveryResult> {
  const [systemDevices, networkResult] = await Promise.all([
    discoverSystemPrinters(),
    discoverNetworkPrinters().catch(() => ({
      networks: [] as string[],
      devices: [] as DiscoveredPrinter[],
      source: 'local-bridge' as const,
    })),
  ]);

  const merged = new Map<string, UnifiedPrinterDevice>();

  for (const device of systemDevices) {
    merged.set(device.id, systemToUnified(device));
  }

  for (const device of networkResult.devices) {
    const unified = networkToUnified(device);
    const hostKey = `network:${device.host}:${device.port}`;
    if (!merged.has(unified.id) && !merged.has(hostKey)) {
      merged.set(unified.id, unified);
      continue;
    }
    // Prefer system entry when same IP already installed in OS.
    const duplicateByHost = [...merged.values()].some(
      (entry) => entry.host === device.host && entry.port === device.port,
    );
    if (!duplicateByHost) merged.set(unified.id, unified);
  }

  const devices = [...merged.values()].sort((a, b) => {
    const rank = (device: UnifiedPrinterDevice) => {
      if (device.source === 'system' && device.kind === 'usb') return 0;
      if (device.source === 'system') return 1;
      return 2;
    };
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  return {
    networks: networkResult.networks,
    devices,
    source: 'local-bridge',
  };
}
