import { Activity, Cpu, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../lib/bytes";
import { requestPersistence, snapshot, type SystemSnapshot } from "../lib/sysinfo";
import { readUsage, type Usage } from "../lib/usage";
import { AUTO_LOCK_MS } from "../lib/vault-session";
import { useInterval, useNow, useVaultSession } from "../os/hooks";
import { useOs } from "../os/OsContext";
import { PROGRAMS, type ProgramProps } from "../os/programs";
import { usePwa } from "../os/pwa";
import { Btn, Card, Notice, ProgramHeader, SourceChip, Stat } from "../ui/ui";

const SAMPLES = 60;

function Sparkline({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (values.length < 2) return <div className="h-8" />;
  const pts = values.map((v, i) => `${(i / (SAMPLES - 1)) * 100},${30 - Math.min(1, v / max) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Frames per second and main-thread lag, measured while this window is open. */
function useLiveMetrics() {
  const [fps, setFps] = useState<number[]>([]);
  const [lag, setLag] = useState<number[]>([]);
  const frames = useRef(0);
  const maxLag = useRef(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      frames.current++;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    let expected = performance.now() + 100;
    const probe = setInterval(() => {
      const now = performance.now();
      maxLag.current = Math.max(maxLag.current, now - expected);
      expected = now + 100;
    }, 100);
    const sample = setInterval(() => {
      setFps((v) => [...v, frames.current].slice(-SAMPLES));
      setLag((v) => [...v, Math.max(0, Math.round(maxLag.current))].slice(-SAMPLES));
      frames.current = 0;
      maxLag.current = 0;
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(probe);
      clearInterval(sample);
    };
  }, []);
  return { fps, lag };
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

export default function KernelMonitor(_: ProgramProps) {
  const { windows, close, focus } = useOs();
  const vault = useVaultSession();
  const pwa = usePwa();
  const now = useNow(1000);
  const { fps, lag } = useLiveMetrics();
  const [sys, setSys] = useState<SystemSnapshot | null>(null);
  const [usage, setUsage] = useState<Usage>(readUsage);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void snapshot().then(setSys);
  }, []);
  useInterval(() => {
    void snapshot().then(setSys);
    setUsage(readUsage());
  }, 3000);

  const lastFps = fps.at(-1);
  const lastLag = lag.at(-1);
  const storagePct = sys?.storageQuota ? ((sys.storageUsed ?? 0) / sys.storageQuota) * 100 : 0;

  const services = [
    { name: "fs-sync", status: "running", desc: "BroadcastChannel keeps tabs in sync" },
    { name: "service-worker", status: pwa.registered ? "running" : "stopped", desc: pwa.offlineReady ? "app cached for offline use" : "not caching (dev or unsupported)" },
    {
      name: "vault-session",
      status: vault.key ? "running" : "stopped",
      desc: vault.key ? `key in memory; auto-lock in ${fmtDuration(Math.max(0, AUTO_LOCK_MS - (now.getTime() - vault.lastActivity)))}` : "locked; no key in memory",
    },
  ];

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-[#0a1012] p-3 [&>*]:shrink-0">
      <ProgramHeader icon={Cpu} color="#00FF88" title="KERNEL MONITOR" chip={<SourceChip>live</SourceChip>} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="mono rounded-[10px] border border-white/10 bg-black/50 p-2.5">
          <div className="text-[9px] text-white/50">FRAME RATE</div>
          <div className="mt-1 text-[14px] font-semibold">{lastFps ?? "…"} fps</div>
          <Sparkline values={fps} max={120} color="#00FF88" />
        </div>
        <div className="mono rounded-[10px] border border-white/10 bg-black/50 p-2.5">
          <div className="text-[9px] text-white/50">MAIN-THREAD LAG</div>
          <div className="mt-1 text-[14px] font-semibold">{lastLag ?? "…"} ms</div>
          <Sparkline values={lag} max={200} color="#ffe66a" />
        </div>
        <Stat label="JS heap" value={sys?.heapUsed != null ? formatBytes(sys.heapUsed) : "n/a"} hint={sys?.heapLimit ? `limit ${formatBytes(sys.heapLimit)}` : "Chromium only"} />
        <Stat label="CPU / RAM" value={`${sys?.cores ?? "?"} cores`} hint={sys?.memoryGb ? `~${sys.memoryGb} GB device memory` : "memory not reported"} />
      </div>

      <Card className="space-y-2">
        <div className="mono flex items-center justify-between text-[11px] font-semibold">
          <span>Storage</span>
          <span className="text-[10px] font-normal text-white/55">{sys?.storageUsed != null ? `${formatBytes(sys.storageUsed)} of ${formatBytes(sys.storageQuota ?? 0)}` : "not reported"}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-cyan" style={{ width: `${Math.max(storagePct, 0.5)}%` }} />
        </div>
        {sys?.persisted ? (
          <Notice>
            <ShieldCheck size={11} className="mr-1 inline" />
            Persistent: the browser will not delete your files to free space.
          </Notice>
        ) : (
          <>
            <Notice tone="warn">Best-effort storage: under disk pressure the browser may delete this site’s data. Make it persistent, and keep backups.</Notice>
            <Btn
              variant="soft"
              onClick={async () => {
                setMsg(await requestPersistence());
                setSys(await snapshot());
              }}
            >
              Make storage persistent
            </Btn>
          </>
        )}
        {msg && <Notice tone="muted">{msg}</Notice>}
      </Card>

      <div className="overflow-hidden rounded-[12px] border border-white/10 bg-black">
        <div className="mono grid grid-cols-[1.6fr_0.8fr_0.7fr_auto] gap-2 border-b border-white/10 px-3 py-2 text-[9px] text-white/50">
          <span>PROCESS (open windows)</span>
          <span>STATE</span>
          <span>UPTIME</span>
          <span />
        </div>
        {windows.map((w) => (
          <div key={w.id} className="mono grid grid-cols-[1.6fr_0.8fr_0.7fr_auto] items-center gap-2 border-b border-white/[0.04] px-3 py-2 text-[11px]">
            <button className="truncate text-left hover:underline" onClick={() => focus(w.id)}>
              {PROGRAMS[w.programId].title}
            </button>
            <span className={`w-fit rounded px-1.5 py-0.5 text-[9px] ${w.minimized ? "bg-white/5 text-white/60" : "border border-accent/20 bg-accent/15 text-accent"}`}>
              {w.minimized ? "MINIMIZED" : "RUNNING"}
            </span>
            <span className="text-[10px] text-white/60">{fmtDuration(now.getTime() - w.openedAt)}</span>
            <button className="rounded px-2 py-1 text-[9px] text-red-300 hover:bg-red-500/20" onClick={() => close(w.id)}>
              End task
            </button>
          </div>
        ))}
        {services.map((s) => (
          <div key={s.name} className="mono grid grid-cols-[1.6fr_0.8fr_0.7fr_auto] items-center gap-2 border-b border-white/[0.04] px-3 py-2 text-[11px]">
            <div className="min-w-0">
              <div className="truncate">{s.name}</div>
              <div className="truncate text-[9px] text-white/45">{s.desc}</div>
            </div>
            <span className={`w-fit rounded px-1.5 py-0.5 text-[9px] ${s.status === "running" ? "bg-accent/15 text-accent" : "bg-white/5 text-white/50"}`}>{s.status.toUpperCase()}</span>
            <span className="text-[10px] text-white/40">service</span>
            <span />
          </div>
        ))}
      </div>

      <Card className="space-y-2">
        <div className="mono flex items-center gap-2 text-[11px] font-semibold">
          <Zap size={11} className="text-accent" /> Bonsai usage today
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Requests" value={usage.count} />
          <Stat label="Tokens" value={usage.tokens.toLocaleString()} hint="from Ollama eval_count" />
          <Stat label="Avg latency" value={`${usage.avgLatency} ms`} />
        </div>
      </Card>

      <div className="mono flex items-center gap-2 text-[10px] text-white/45">
        <Activity size={11} /> {sys ? `${sys.online ? "Online" : "Offline"}${sys.connection ? ` · ${sys.connection}` : ""} · ${sys.platform}` : "…"}
      </div>
    </div>
  );
}
