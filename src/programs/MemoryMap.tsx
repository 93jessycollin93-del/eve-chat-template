import { Download, HardDrive, QrCode, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { buildBackupFromDisk, getLastBackup, parseBackup, planRestore, setLastBackup, type ParsedBackup } from "../lib/backup";
import { BUILD } from "../lib/build-info";
import { formatBytes } from "../lib/bytes";
import { backupFileName, pickFiles, saveToDevice } from "../lib/download";
import { fileSize, isMarker, putMany } from "../lib/fs";
import { topLevel } from "../lib/paths";
import { deletePod, putPods, type Pod } from "../lib/pods";
import { encodeFragments, type FragmentSet } from "../lib/qrbackup";
import { restoreQrPayload } from "../lib/restore";
import { useFiles, usePods, useToast } from "../os/hooks";
import type { ProgramProps } from "../os/programs";
import { QrRestore, QrSet } from "../ui/qr";
import { Btn, Card, Notice, ProgramHeader, SourceChip } from "../ui/ui";

const BAR_COLORS = ["#00FF88", "#5ee9ff", "#ff7ad1", "#ffe66a", "#a78bfa", "#ff8c42", "#7cffc1", "#ffd27a"];

export default function MemoryMap(_: ProgramProps) {
  const { files } = useFiles();
  const { pods } = usePods();
  const [tab, setTab] = useState<"storage" | "pods" | "paper">("storage");
  const [lastBackup, setLast] = useState(getLastBackup);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [qr, setQr] = useState<{ podId: string; set: FragmentSet } | null>(null);
  const [toast, showToast] = useToast(6000);
  const [error, setError] = useState("");

  const real = useMemo(() => files.filter((f) => !isMarker(f)), [files]);
  const groups = useMemo(() => {
    const m = new Map<string, { bytes: number; count: number }>();
    for (const f of real) {
      const g = topLevel(f.path) || "(root)";
      const cur = m.get(g) ?? { bytes: 0, count: 0 };
      m.set(g, { bytes: cur.bytes + fileSize(f), count: cur.count + 1 });
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.bytes - a.bytes);
  }, [real]);
  const total = groups.reduce((n, g) => n + g.bytes, 0);
  const daysSince = lastBackup ? Math.floor((Date.now() - new Date(lastBackup.at).getTime()) / 86_400_000) : null;

  const exportAll = async () => {
    const backup = await buildBackupFromDisk({ version: BUILD.version, commit: BUILD.commit });
    const json = JSON.stringify(backup, null, 2);
    const r = await saveToDevice(backupFileName(), json, "application/json");
    if (r.method === "cancelled") return;
    setLastBackup(backup.exportedAt, r.bytes);
    setLast(getLastBackup());
    showToast(`Backup saved: ${backup.stats.totalFiles} files + ${backup.stats.podCount} pods, ${formatBytes(r.bytes)}. Fingerprint ${backup.stats.rootHash.slice(0, 12)}…`);
  };

  const chooseBackup = async () => {
    setError("");
    const [f] = await pickFiles({ accept: ".json,application/json" });
    if (!f) return;
    try {
      setPending(await parseBackup(await f.text()));
    } catch (err) {
      setError(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const plan = pending ? planRestore(files, pending) : null;

  const applyBackup = async () => {
    if (!plan) return;
    if (plan.files.length) await putMany(plan.files);
    if (plan.pods.length) await putPods(plan.pods);
    setPending(null);
    showToast(
      `Restored ${plan.files.length} files and ${plan.pods.length} pods.${plan.skippedVault ? ` Skipped ${plan.skippedVault} vault file(s) sealed with a different passphrase.` : ""}`,
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#0b1216]">
      <div className="space-y-2 border-b border-white/10 p-3">
        <ProgramHeader icon={HardDrive} color="#5ee9ff" title="MEMORY MAP" chip={<SourceChip>IndexedDB</SourceChip>} />
        <div className="flex flex-wrap gap-1" role="tablist">
          {(["storage", "pods", "paper"] as const).map((t) => (
            <Btn key={t} role="tab" aria-selected={tab === t} variant={tab === t ? "soft" : "ghost"} onClick={() => setTab(t)} className="h-7 px-2.5">
              {t === "storage" ? "Backup" : t === "pods" ? `Pods (${pods.length})` : "Paper restore"}
            </Btn>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {toast && <Notice>{toast}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {tab === "storage" && (
          <>
            <Notice tone={daysSince === null || daysSince > 7 ? "danger" : "accent"}>
              {lastBackup
                ? `Last backup: ${new Date(lastBackup.at).toLocaleString()} (${formatBytes(lastBackup.bytes)})${daysSince! > 7 ? ` — ${daysSince} days ago. Back up again.` : ""}`
                : "Never backed up. Your files exist only in this browser — export a backup and keep it somewhere else."}
            </Notice>
            <div className="flex flex-wrap gap-1.5">
              <Btn variant="primary" icon={Download} onClick={() => void exportAll()}>
                Export full backup
              </Btn>
              <Btn icon={Upload} onClick={() => void chooseBackup()}>
                Restore from backup file
              </Btn>
            </div>

            {pending && (
              <Card className="space-y-2">
                <div className="mono text-[11px] font-semibold">
                  Backup v{pending.version}
                  {pending.exportedAt ? ` from ${new Date(pending.exportedAt).toLocaleString()}` : ""}: {pending.files.length} files, {pending.pods.length} pods
                </div>
                {pending.verified === true && <Notice>Fingerprint verified: the file is exactly as it was exported.</Notice>}
                {pending.verified === false && <Notice tone="danger">Fingerprint MISMATCH: this backup was modified or damaged after export. Restore only if you trust it.</Notice>}
                {pending.verified === null && <Notice tone="warn">Older backup format without a fingerprint; contents cannot be verified.</Notice>}
                {plan && plan.overwrites > 0 && <Notice tone="warn">{plan.overwrites} of your current files have different content at the same path and will be replaced.</Notice>}
                {plan && plan.skippedVault > 0 && (
                  <Notice tone="warn">
                    {plan.skippedVault} vault file(s) in this backup were sealed with a different passphrase than this device’s vault. They will be skipped so your current vault keeps
                    working. To get them, restore this backup on a device without a vault.
                  </Notice>
                )}
                <div className="flex gap-1.5">
                  <Btn variant="soft" onClick={() => void applyBackup()}>
                    Restore (merge)
                  </Btn>
                  <Btn onClick={() => setPending(null)}>Cancel</Btn>
                </div>
              </Card>
            )}

            <Card className="space-y-2">
              <div className="mono flex justify-between text-[11px]">
                <span className="font-semibold">Where your bytes live</span>
                <span className="text-white/55">
                  {real.length} files · {formatBytes(total)}
                </span>
              </div>
              {groups.map((g, i) => (
                <div key={g.name} className="mono space-y-1 text-[10px]">
                  <div className="flex justify-between">
                    <span>{g.name === "(root)" ? "(root)" : `/${g.name}`}</span>
                    <span className="text-white/55">
                      {g.count} · {formatBytes(g.bytes)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full" style={{ width: `${total ? Math.max(1, (g.bytes / total) * 100) : 0}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                  </div>
                </div>
              ))}
              {groups.length === 0 && <div className="mono text-[10px] text-white/40">No files yet.</div>}
            </Card>
          </>
        )}

        {tab === "pods" && (
          <>
            <div className="mono text-[10px] leading-5 text-white/55">
              Each Bonsai exchange is saved as a memory pod. With memory on, Bonsai reads your recent pods before answering. Pods are included in backups.
            </div>
            {pods.length === 0 && <div className="mono rounded-[10px] border border-dashed border-white/10 p-4 text-[11px] text-white/40">No pods yet. Talk to Bonsai to create some.</div>}
            {pods.map((p: Pod) => (
              <div key={p.id} className="mono space-y-2 rounded-[12px] border border-white/10 bg-white/[0.04] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SourceChip>{p.model}</SourceChip>
                    <span className="text-[9px] text-white/55">{new Date(p.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="flex gap-1">
                    <Btn className="h-7" icon={Download} onClick={() => saveToDevice(`pod-${p.id}.json`, JSON.stringify(p, null, 2), "application/json")}>
                      JSON
                    </Btn>
                    <Btn
                      className="h-7"
                      variant="soft"
                      icon={QrCode}
                      onClick={async () => setQr(qr?.podId === p.id ? null : { podId: p.id, set: await encodeFragments({ kind: "pod", data: p }) })}
                    >
                      Paper
                    </Btn>
                    <Btn className="h-7" variant="danger" icon={Trash2} aria-label="Delete pod" onClick={() => confirm("Delete this memory pod?") && void deletePod(p.id)}>
                      <span className="sr-only">Delete</span>
                    </Btn>
                  </div>
                </div>
                <div className="text-[11px] leading-5 text-white/90">{p.summary}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-[8px] border border-white/5 bg-black/60 p-2">
                    <div className="text-[8px] text-white/40">YOU</div>
                    <div className="mt-1 line-clamp-3 text-[10px]">{p.fullText.user}</div>
                  </div>
                  <div className="rounded-[8px] border border-accent/10 bg-black/60 p-2">
                    <div className="text-[8px] text-accent/60">BONSAI</div>
                    <div className="mt-1 line-clamp-3 text-[10px]">{p.fullText.assistant}</div>
                  </div>
                </div>
                {qr?.podId === p.id && <QrSet title={`pod ${p.id}`} fragments={qr.set.fragments} hash={qr.set.hash} />}
              </div>
            ))}
          </>
        )}

        {tab === "paper" && (
          <Card className="space-y-2">
            <div className="mono text-[11px] font-semibold">Restore from a paper backup</div>
            <div className="mono text-[10px] leading-5 text-white/55">
              Scan each QR code of a printed sheet in any order. Every code is checked against the set’s checksum before anything is restored. Codes from the original Sovereign Foundry
              artifact (F|… text) work too.
            </div>
            <QrRestore onComplete={restoreQrPayload} />
          </Card>
        )}
      </div>
    </div>
  );
}
