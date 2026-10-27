import { BUILD } from "./build-info";
import { formatBytes } from "./bytes";

interface NavigatorExtras {
  deviceMemory?: number;
  connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
}

export interface SystemSnapshot {
  cores: number | null;
  memoryGb: number | null;
  platform: string;
  userAgent: string;
  language: string;
  screen: string;
  online: boolean;
  connection: string | null;
  storageUsed: number | null;
  storageQuota: number | null;
  persisted: boolean | null;
  heapUsed: number | null;
  heapLimit: number | null;
  secureContext: boolean;
}

export async function snapshot(): Promise<SystemSnapshot> {
  const nav = navigator as Navigator & NavigatorExtras;
  let storageUsed: number | null = null;
  let storageQuota: number | null = null;
  let persisted: boolean | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    storageUsed = est?.usage ?? null;
    storageQuota = est?.quota ?? null;
    persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    /* not supported */
  }
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const c = nav.connection;
  return {
    cores: navigator.hardwareConcurrency || null,
    memoryGb: nav.deviceMemory ?? null,
    platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "unknown",
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: `${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
    online: navigator.onLine,
    connection: c ? [c.effectiveType, c.downlink ? `${c.downlink} Mbps` : null, c.rtt ? `${c.rtt}ms rtt` : null].filter(Boolean).join(", ") : null,
    storageUsed,
    storageQuota,
    persisted,
    heapUsed: mem?.usedJSHeapSize ?? null,
    heapLimit: mem?.jsHeapSizeLimit ?? null,
    secureContext: window.isSecureContext,
  };
}

export async function systemInfoLines(host: string): Promise<string[]> {
  const s = await snapshot();
  const na = "not reported";
  return [
    `Host:          ${host}`,
    `OS build:      Sovereign Foundry v${BUILD.version} (${BUILD.shortCommit}), built ${BUILD.builtAt}`,
    `Platform:      ${s.platform}`,
    `Browser:       ${s.userAgent}`,
    `CPU cores:     ${s.cores ?? na}`,
    `Device memory: ${s.memoryGb ? `~${s.memoryGb} GB` : na}`,
    `JS heap:       ${s.heapUsed !== null ? `${formatBytes(s.heapUsed)} of ${formatBytes(s.heapLimit ?? 0)}` : na}`,
    `Screen:        ${s.screen}`,
    `Network:       ${s.online ? "online" : "offline"}${s.connection ? ` (${s.connection})` : ""}`,
    `Storage:       ${s.storageUsed !== null ? `${formatBytes(s.storageUsed)} used of ${formatBytes(s.storageQuota ?? 0)}` : na}`,
    `Persistence:   ${s.persisted === null ? na : s.persisted ? "persistent (protected from eviction)" : "best-effort (may be evicted; run: persist)"}`,
    `Secure ctx:    ${s.secureContext ? "yes" : "no (crypto and camera need https)"}`,
  ];
}

export async function requestPersistence(): Promise<string> {
  if (!navigator.storage?.persist) return "This browser cannot make storage persistent.";
  if (await navigator.storage.persisted()) return "Storage is already persistent.";
  const granted = await navigator.storage.persist();
  return granted
    ? "Granted: the browser will not evict your files under storage pressure."
    : "Not granted. Browsers usually grant this once the site is installed to the home screen or used regularly.";
}
