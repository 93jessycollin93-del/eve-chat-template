import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BUILD } from "../lib/build-info";
import { formatBytes } from "../lib/bytes";
import { compress, compressionSupported, decompress, sha256Hex } from "../lib/compression";
import { openDb } from "../lib/db";
import { fileSize, listFiles } from "../lib/fs";
import { checkReachability } from "../lib/ollama";
import { seedIfNew } from "../lib/seed";
import { plaintextVaultFiles, readMeta, SEALED_EXT } from "../lib/vault";

type Status = "ok" | "warn" | "fail" | "info";
interface Line {
  text: string;
  status?: Status;
  detail?: string;
}

function dots(label: string): string {
  return ` > ${label} ${".".repeat(Math.max(2, 24 - label.length))}`;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, string]> {
  const t0 = performance.now();
  const v = await fn();
  return [v, `${(performance.now() - t0).toFixed(1)}ms`];
}

/**
 * Probes the real device and storage. Returns false if the OS cannot run
 * (no IndexedDB), in which case the boot screen stays up with the reason.
 */
async function runProbes(push: (l: Line) => void, host: string): Promise<boolean> {
  push({ text: `SOVEREIGN FOUNDRY v${BUILD.version} (${BUILD.shortCommit}) — built ${BUILD.builtAt.slice(0, 10)}` });
  push({ text: `CPU: ${navigator.hardwareConcurrency || "?"} logical cores` });
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  push({ text: `RAM: ${mem ? `~${mem} GB (browser-reported)` : "not reported by this browser"}` });
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) push({ text: `Storage: ${formatBytes(est.usage ?? 0)} used of ${formatBytes(est.quota ?? 0)} available to this site` });
  } catch {
    /* estimate not available */
  }
  push({ text: "" });
  push({ text: "Checking subsystems..." });

  try {
    const [, t] = await timed(openDb);
    push({ text: dots("indexeddb"), status: "ok", detail: t });
  } catch (err) {
    push({ text: dots("indexeddb"), status: "fail", detail: err instanceof Error ? err.message : String(err) });
    push({ text: "" });
    push({ text: "Cannot start: this browser blocks IndexedDB (private browsing?). Your files need it.", status: "fail" });
    return false;
  }

  const [seeded, tSeed] = await timed(seedIfNew);
  const files = await listFiles();
  const bytes = files.reduce((n, f) => n + fileSize(f), 0);
  push({ text: dots("filesystem"), status: "ok", detail: `${files.length} files, ${formatBytes(bytes)}${seeded ? " (starter files created)" : ""} ${tSeed}` });

  if (compressionSupported()) {
    const [ok, t] = await timed(async () => {
      const sample = new TextEncoder().encode("Information = Compressed Experience");
      const back = await decompress(await compress(sample, "gzip"), "gzip");
      return back.length === sample.length;
    });
    push({ text: dots("compression_streams"), status: ok ? "ok" : "fail", detail: ok ? `gzip round-trip ${t}` : "round-trip mismatch" });
  } else {
    push({ text: dots("compression_streams"), status: "warn", detail: "not supported by this browser" });
  }

  try {
    const [, t] = await timed(() => sha256Hex("singularity"));
    push({ text: dots("webcrypto"), status: "ok", detail: `SHA-256 + AES-GCM ${t}` });
  } catch {
    push({ text: dots("webcrypto"), status: "fail", detail: "unavailable (needs https)" });
  }

  const meta = readMeta(files);
  const sealed = files.filter((f) => f.path.endsWith(SEALED_EXT)).length;
  const plain = plaintextVaultFiles(files).length;
  if (meta) push({ text: dots("vault"), status: plain ? "warn" : "ok", detail: `sealed, ${sealed} items${plain ? `, ${plain} plaintext file(s) waiting to be sealed` : ""}` });
  else push({ text: dots("vault"), status: "warn", detail: `not set up — ${plain} plaintext file(s) in /Vault` });

  try {
    const persisted = await navigator.storage?.persisted?.();
    push({
      text: dots("persistence"),
      status: persisted ? "ok" : "warn",
      detail: persisted ? "persistent — browser will not evict" : "best-effort — enable in Kernel Monitor",
    });
  } catch {
    push({ text: dots("persistence"), status: "warn", detail: "unknown" });
  }

  push({ text: dots("service_worker"), status: "serviceWorker" in navigator ? "ok" : "warn", detail: "serviceWorker" in navigator ? "supported (offline after first load)" : "unsupported" });

  const endpoint = (() => {
    try {
      return localStorage.getItem("bonsai_endpoint");
    } catch {
      return null;
    }
  })();
  if (endpoint) {
    const key = localStorage.getItem("bonsai_secret") || "";
    const r = await checkReachability(endpoint, key, 1500);
    push({ text: dots("bonsai"), status: r.ok ? "ok" : "warn", detail: r.ok ? `${endpoint} — ${r.models.length} models` : `${endpoint} unreachable` });
  } else {
    push({ text: dots("bonsai"), status: "info", detail: "not configured yet" });
  }

  push({ text: dots("host"), status: "ok", detail: host });
  push({ text: "" });
  push({ text: "BOOT COMPLETE — Sovereign Foundry online" });
  return true;
}

const STATUS_LABEL: Record<Status, string> = { ok: "[OK]", warn: "[WARN]", fail: "[FAIL]", info: "[--]" };
const STATUS_COLOR: Record<Status, string> = { ok: "text-accent", warn: "text-gold", fail: "text-red-400", info: "text-white/50" };

export function Boot({ host, onDone }: { host: string; onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState(false);
  const skip = useRef(false);
  const doneRef = useRef(onDone);
  useLayoutEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    let cancelled = false;
    const queue: Line[] = [];
    let shown = 0;
    // Reveal lines at a steady pace for readability; skipping shows the rest at once.
    const tick = setInterval(() => {
      if (cancelled) return;
      if (shown < queue.length) {
        shown = skip.current ? queue.length : shown + 1;
        setLines(queue.slice(0, shown));
      }
    }, 45);
    runProbes((l) => queue.push(l), host).then((ok) => {
      const wait = setInterval(() => {
        if (cancelled || shown < queue.length) return;
        clearInterval(wait);
        clearInterval(tick);
        if (!ok) setFailed(true);
        else {
          setFinished(true);
          setTimeout(() => !cancelled && doneRef.current(), skip.current ? 0 : 450);
        }
      }, 30);
    });
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [host]);

  return (
    <div
      className="mono flex min-h-full flex-col overflow-auto bg-black p-5 text-accent sm:p-6"
      style={{ paddingTop: "calc(var(--safe-top) + 20px)" }}
      onClick={() => (skip.current = true)}
      onKeyDown={() => (skip.current = true)}
      role="log"
      aria-live="polite"
      tabIndex={0}
    >
      <div className="max-w-3xl">
        <div className="mb-4 text-[10px] tracking-[0.3em] opacity-60">SOVEREIGN FOUNDRY // CYBERNETIC OS</div>
        {lines.map((l, i) => (
          <div key={i} className="text-[11px] leading-5 whitespace-pre-wrap sm:text-[12px]">
            <span className="mr-2 opacity-40">{String(i).padStart(2, "0")}</span>
            {l.text}
            {l.status && <span className={`ml-1 ${STATUS_COLOR[l.status]}`}>{STATUS_LABEL[l.status]}</span>}
            {l.detail && <span className="ml-1 text-white/60">{l.detail}</span>}
          </div>
        ))}
        {!failed && !finished && <div className="mt-3 inline-block h-4 w-2 animate-pulse bg-accent" />}
        {failed && (
          <button className="mt-4 rounded border border-accent/40 px-3 py-1.5 text-[11px]" onClick={() => location.reload()}>
            Try again
          </button>
        )}
      </div>
      <div className="mt-auto pt-6 text-[10px] opacity-30">{failed ? "" : "Tap or press any key to skip"}</div>
    </div>
  );
}
