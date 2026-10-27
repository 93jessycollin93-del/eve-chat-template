import { Copy, Diamond, FileCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parseBackup } from "../lib/backup";
import { formatBytes } from "../lib/bytes";
import { pickFiles } from "../lib/download";
import { computeIntegrity, type IntegrityReport } from "../lib/integrity";
import { useFiles, usePods, useToast } from "../os/hooks";
import type { ProgramProps } from "../os/programs";
import { Btn, Card, inputClass, Notice, ProgramHeader, SourceChip, Spinner } from "../ui/ui";

const LAST_KEY = "sf_last_fingerprint";

function hashBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** Draws the root hash itself: 32 ring segments, one per byte, around a spinning diamond bar. */
function Core({ root }: { root: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const bytes = root ? hashBytes(root) : new Array(32).fill(40);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    const draw = () => {
      t += reduce ? 0 : 0.01;
      const dpr = 2;
      const w = (canvas.width = canvas.clientWidth * dpr);
      const h = (canvas.height = canvas.clientHeight * dpr);
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.36;
      ctx.clearRect(0, 0, w, h);

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3);
      glow.addColorStop(0, "black");
      glow.addColorStop(0.5, "black");
      glow.addColorStop(0.62, "rgba(255,122,209,0.45)");
      glow.addColorStop(0.75, "rgba(0,255,136,0.18)");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.3, 0, Math.PI * 2);
      ctx.fill();

      // Fingerprint ring: segment length and hue come straight from the hash bytes.
      bytes.forEach((b, i) => {
        const a0 = (i / bytes.length) * Math.PI * 2 + t * 0.15;
        const a1 = a0 + (Math.PI * 2) / bytes.length - 0.04;
        ctx.strokeStyle = `hsla(${(b / 255) * 300 + 120}, 90%, 65%, ${0.35 + (b / 255) * 0.6})`;
        ctx.lineWidth = (3 + (b / 255) * 9) * dpr * 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, R + (b % 4) * 3 * dpr, a0, a1);
        ctx.stroke();
      });

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.2);
      ctx.scale(1, 0.28);
      ctx.strokeStyle = "rgba(255,230,106,0.45)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t);
      const bw = R * 0.45;
      const bh = R * 0.1;
      ctx.fillStyle = "#e8f7ff";
      ctx.shadowColor = "#5ee9ff";
      ctx.shadowBlur = 18 * dpr;
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.restore();
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [root]);
  return <canvas ref={ref} className="h-[200px] w-full shrink-0 sm:h-[240px]" aria-hidden />;
}

export default function Singularity(_: ProgramProps) {
  const { files } = useFiles();
  const { pods } = usePods();
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [computing, setComputing] = useState(true);
  const [compare, setCompare] = useState("");
  const [last, setLast] = useState<{ root: string; at: string } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) || "null");
    } catch {
      return null;
    }
  });
  const [backupCheck, setBackupCheck] = useState<{ tone: "accent" | "danger" | "warn"; msg: string } | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    let cancelled = false;
    setComputing(true);
    const id = setTimeout(async () => {
      const r = await computeIntegrity(files, pods);
      if (!cancelled) {
        setReport(r);
        setComputing(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [files, pods]);

  const remember = () => {
    if (!report) return;
    const v = { root: report.root, at: new Date().toISOString() };
    localStorage.setItem(LAST_KEY, JSON.stringify(v));
    setLast(v);
    showToast("Fingerprint saved as your reference point.");
  };

  const cmp = compare.trim().toLowerCase();
  const cmpState = !cmp || !report ? null : cmp === report.root ? "match" : /^[0-9a-f]{64}$/.test(cmp) ? "differ" : "invalid";

  return (
    <div className="flex h-full flex-col overflow-auto bg-black [&>*]:shrink-0">
      <div className="p-3 pb-0">
        <ProgramHeader icon={Diamond} color="#ff7ad1" title="SINGULARITY — every byte you keep, collapsed into one point" chip={<SourceChip>SHA-256</SourceChip>} />
      </div>
      <Core root={report?.root ?? null} />
      <div className="space-y-3 p-3 pt-0">
        <Card>
          <div className="mono text-[9px] tracking-wide text-white/50 uppercase">Root fingerprint</div>
          {computing && !report ? (
            <Spinner label="Hashing everything…" />
          ) : (
            <div className="mono mt-1 text-[12px] leading-5 text-pink select-text">
              {report?.root.match(/.{1,8}/g)?.join(" ")}
            </div>
          )}
          <div className="mono mt-2 text-[10px] text-white/50">
            {report ? `${report.entries.length} items · ${formatBytes(report.totalBytes)} · content only (timestamps ignored)` : ""}
            {computing && report ? " · updating…" : ""}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Btn icon={Copy} disabled={!report} onClick={async () => {
              await navigator.clipboard?.writeText(report!.root).catch(() => {});
              showToast("Copied.");
            }}>
              Copy
            </Btn>
            <Btn disabled={!report} onClick={remember}>
              Save as reference
            </Btn>
            <Btn icon={FileCheck} onClick={async () => {
              const [f] = await pickFiles({ accept: ".json,application/json" });
              if (!f) return;
              try {
                const parsed = await parseBackup(await f.text());
                if (parsed.verified === true) setBackupCheck({ tone: "accent", msg: `${f.name}: intact. Its fingerprint matches its contents (${parsed.files.length} files, ${parsed.pods.length} pods).${report && parsed.actualRoot === report.root ? " It is identical to what you have now." : ""}` });
                else if (parsed.verified === false) setBackupCheck({ tone: "danger", msg: `${f.name}: DOES NOT MATCH. The backup was changed or damaged after it was made.` });
                else setBackupCheck({ tone: "warn", msg: `${f.name}: an older backup with no fingerprint to check. Its content fingerprint is ${parsed.actualRoot.slice(0, 16)}…` });
              } catch (err) {
                setBackupCheck({ tone: "danger", msg: `${f.name}: ${err instanceof Error ? err.message : String(err)}` });
              }
            }}>
              Verify a backup file
            </Btn>
          </div>
          {last && report && (
            <div className="mt-2">
              {last.root === report.root ? (
                <Notice>Unchanged since your reference from {new Date(last.at).toLocaleString()}.</Notice>
              ) : (
                <Notice tone="warn">Changed since your reference from {new Date(last.at).toLocaleString()}.</Notice>
              )}
            </div>
          )}
          {backupCheck && (
            <div className="mt-2">
              <Notice tone={backupCheck.tone}>{backupCheck.msg}</Notice>
            </div>
          )}
          {toast && (
            <div className="mt-2">
              <Notice>{toast}</Notice>
            </div>
          )}
        </Card>

        <Card>
          <label className="mono text-[9px] tracking-wide text-white/50 uppercase" htmlFor="cmp">
            Compare with another device or an earlier copy
          </label>
          <input id="cmp" value={compare} onChange={(e) => setCompare(e.target.value.replace(/\s/g, ""))} placeholder="paste a 64-character fingerprint" className={`${inputClass} mt-1.5 w-full`} />
          {cmpState === "match" && <div className="mt-2"><Notice>Identical. Every byte matches.</Notice></div>}
          {cmpState === "differ" && <div className="mt-2"><Notice tone="warn">Different. At least one file or pod differs.</Notice></div>}
          {cmpState === "invalid" && <div className="mt-2"><Notice tone="muted">A fingerprint is 64 hex characters.</Notice></div>}
        </Card>

        {report && report.groups.length > 0 && (
          <div className="overflow-hidden rounded-[12px] border border-white/10">
            <div className="mono grid grid-cols-[1.2fr_0.5fr_0.7fr_1fr] gap-2 border-b border-white/10 px-3 py-2 text-[9px] text-white/50">
              <span>FOLDER</span>
              <span>ITEMS</span>
              <span>SIZE</span>
              <span>FINGERPRINT</span>
            </div>
            {report.groups.map((g) => (
              <div key={g.group} className="mono grid grid-cols-[1.2fr_0.5fr_0.7fr_1fr] gap-2 border-b border-white/[0.04] px-3 py-2 text-[10px]">
                <span className="truncate">{g.group === "/" ? "(root)" : g.group === "Pods" ? "Memory pods" : `/${g.group}`}</span>
                <span>{g.count}</span>
                <span>{formatBytes(g.bytes)}</span>
                <span className="truncate text-white/60">{g.hash.slice(0, 16)}…</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
