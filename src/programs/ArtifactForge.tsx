import { ArrowLeft, ClipboardPaste, Download, Hammer, Play, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "../lib/bytes";
import { pickFiles, saveToDevice } from "../lib/download";
import { fileSize, isMarker, remove, uniquePath, writeText, type FileRecord } from "../lib/fs";
import { basename, extname, isWithin } from "../lib/paths";
import { useFiles, useToast } from "../os/hooks";
import type { ProgramProps } from "../os/programs";
import { Btn, Card, inputClass, Notice, ProgramHeader, SourceChip, Stat } from "../ui/ui";

const DIR = "/Artifacts";

function isArtifact(f: FileRecord): boolean {
  return isWithin(f.path, DIR) && !isMarker(f) && ["html", "htm"].includes(extname(f.path));
}

function safeName(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "artifact";
  return /\.html?$/i.test(base) ? base : `${base}.html`;
}

export default function ArtifactForge(_: ProgramProps) {
  const { files } = useFiles();
  const [running, setRunning] = useState<FileRecord | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteHtml, setPasteHtml] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const artifacts = files.filter(isArtifact).sort((a, b) => b.modified - a.modified);
  const totalBytes = artifacts.reduce((n, f) => n + fileSize(f), 0);

  if (running) {
    const live = files.find((f) => f.path === running.path) ?? running;
    return (
      <div className="flex h-full flex-col bg-black">
        <div className="flex items-center gap-2 border-b border-white/10 p-2">
          <Btn icon={ArrowLeft} onClick={() => setRunning(null)}>
            Back
          </Btn>
          <span className="mono min-w-0 flex-1 truncate text-[11px]">{basename(live.path)}</span>
          <SourceChip tone="muted">sandboxed: no file access</SourceChip>
        </div>
        <iframe
          title={basename(live.path)}
          srcDoc={live.content}
          // No allow-same-origin: the artifact runs in an opaque origin and cannot read Foundry data.
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-[#13100c] p-3 [&>*]:shrink-0">
      <ProgramHeader icon={Hammer} color="#ff8c42" title="ARTIFACT FORGE" chip={<SourceChip>sandboxed iframe</SourceChip>} />
      <div className="mono rounded-[12px] border border-amber/20 bg-amber/10 p-3 text-[12px] leading-6 text-[#ffdac0]">
        “Artifacts aren’t cost, they’re catalyst. Every artifact is a universe you chose to keep.”
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Kept" value={artifacts.length} />
        <Stat label="Total size" value={formatBytes(totalBytes)} />
        <Stat label="Latest" value={artifacts[0] ? new Date(artifacts[0].modified).toLocaleDateString() : "—"} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Btn
          variant="primary"
          icon={Upload}
          onClick={async () => {
            const picked = await pickFiles({ accept: ".html,.htm,text/html", multiple: true });
            for (const f of picked) await writeText(uniquePath(files, `${DIR}/${safeName(f.name)}`), await f.text());
            if (picked.length) showToast(`Kept ${picked.length} artifact(s).`);
          }}
        >
          Import .html
        </Btn>
        <Btn icon={ClipboardPaste} onClick={() => setPasting((p) => !p)}>
          Paste HTML
        </Btn>
      </div>

      {pasting && (
        <Card className="space-y-2">
          <input value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="name (e.g. cybernetic-os)" className={`${inputClass} w-full`} aria-label="Artifact name" />
          <textarea
            value={pasteHtml}
            onChange={(e) => setPasteHtml(e.target.value)}
            placeholder="<!doctype html>…"
            className="mono h-[120px] w-full resize-y rounded-[8px] border border-white/10 bg-black p-2 text-[10px] outline-none"
            aria-label="Artifact HTML"
          />
          <Btn
            variant="soft"
            disabled={!pasteHtml.trim()}
            onClick={async () => {
              const path = uniquePath(files, `${DIR}/${safeName(pasteName || "pasted-artifact")}`);
              await writeText(path, pasteHtml);
              setPasteHtml("");
              setPasteName("");
              setPasting(false);
              showToast(`Kept ${basename(path)}.`);
            }}
          >
            Keep it
          </Btn>
        </Card>
      )}

      {toast && <Notice>{toast}</Notice>}

      {artifacts.length === 0 ? (
        <div className="mono rounded-[12px] border border-dashed border-white/10 p-4 text-[11px] leading-5 text-white/45">
          No artifacts kept yet. Download an HTML artifact (from Claude or anywhere) and import it, or paste its HTML. It is stored in {DIR} and runs offline.
        </div>
      ) : (
        <div className="space-y-2">
          {artifacts.map((a) => (
            <div key={a.path} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] p-2.5">
              <div className="min-w-0 flex-1">
                <div className="mono truncate text-[12px]">{basename(a.path)}</div>
                <div className="mono text-[9px] text-white/50">
                  {formatBytes(fileSize(a))} · kept {new Date(a.created).toLocaleDateString()}
                </div>
              </div>
              <Btn variant="soft" icon={Play} onClick={() => setRunning(a)}>
                Run
              </Btn>
              <Btn icon={Download} aria-label={`Export ${basename(a.path)}`} onClick={() => saveToDevice(basename(a.path), a.content, "text/html")}>
                <span className="sr-only">Export</span>
              </Btn>
              {confirmDelete === a.path ? (
                <Btn
                  variant="solid-danger"
                  onClick={async () => {
                    await remove(a.path);
                    setConfirmDelete(null);
                  }}
                >
                  Delete forever?
                </Btn>
              ) : (
                <Btn variant="danger" icon={Trash2} aria-label={`Delete ${basename(a.path)}`} onClick={() => setConfirmDelete(a.path)}>
                  <span className="sr-only">Delete</span>
                </Btn>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
