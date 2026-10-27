import { ArrowLeft, Download, FilePlus, FileText, Folder, FolderPlus, HardDrive, Lock, QrCode, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "../lib/bytes";
import { pickFiles, saveToDevice } from "../lib/download";
import { fileBytes, fileSize, isText, listDir, mkdir, move, remove, uniquePath, writeBytes, writeText, type FileRecord } from "../lib/fs";
import { basename, extname, isWithin, joinPath } from "../lib/paths";
import { encodeFragments, type FragmentSet } from "../lib/qrbackup";
import { isSealedPath, META_PATH, VAULT_DIR } from "../lib/vault";
import { useFiles, useMediaQuery, useToast } from "../os/hooks";
import { useOs } from "../os/OsContext";
import type { ProgramProps } from "../os/programs";
import { QrSet } from "../ui/qr";
import { Btn, inputClass, Notice, ProgramHeader, SourceChip } from "../ui/ui";

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
const PAPER_LIMIT = 6000;

function Preview({ file }: { file: FileRecord }) {
  const type = file.mime?.startsWith("image/") ? file.mime : IMAGE_TYPES[extname(file.path)];
  const url = useMemo(() => {
    if (!type) return null;
    const bytes = fileBytes(file);
    return URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type }));
  }, [file, type]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (url) return <img src={url} alt={basename(file.path)} className="max-h-[220px] max-w-full rounded-[8px] border border-white/10 bg-white/5 object-contain" />;
  if (isText(file)) {
    return (
      <pre className="mono max-h-[160px] overflow-auto rounded-[8px] border border-white/10 bg-black p-2 text-[10px] whitespace-pre-wrap text-white/75">
        {file.content.slice(0, 2000) || "(empty file)"}
      </pre>
    );
  }
  return null;
}

export default function FileExplorer({ args }: ProgramProps) {
  const { files, loading } = useFiles();
  const { open } = useOs();
  const touch = useMediaQuery("(pointer: coarse)");
  const [dir, setDir] = useState(args?.dir ?? "/");
  const [selected, setSelected] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ kind: "folder" | "file" | "rename"; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [paper, setPaper] = useState<FragmentSet | null>(null);
  const [toast, showToast] = useToast();
  const [error, setError] = useState("");

  useEffect(() => {
    if (args?.dir) setDir(args.dir);
  }, [args?.dir]);

  const { folders, files: here } = listDir(files, dir);
  const sel = here.find((f) => f.path === selected) ?? null;

  const go = (d: string) => {
    setDir(d);
    setSelected(null);
    setNaming(null);
    setPaper(null);
    setConfirmDelete(false);
  };

  const up = () => go(dir === "/" ? "/" : dir.slice(0, dir.lastIndexOf("/")) || "/");

  const attempt = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openFile = (f: FileRecord) => {
    if (isSealedPath(f.path) || f.path === META_PATH) open("vault");
    else if (["html", "htm"].includes(extname(f.path)) && isWithin(f.path, "/Artifacts")) open("forge");
    else if (isText(f)) open("theorypad", { path: f.path });
    else setSelected(f.path);
  };

  const submitName = () =>
    attempt(async () => {
      if (!naming) return;
      const name = naming.value.trim();
      if (!name || name.includes("/")) throw new Error("Use a plain name without slashes.");
      if (naming.kind === "folder") await mkdir(joinPath(dir, name));
      else if (naming.kind === "file") {
        const path = uniquePath(files, joinPath(dir, name));
        await writeText(path, "");
        open("theorypad", { path });
      } else if (sel) {
        await move(sel.path, joinPath(dir, name));
        setSelected(joinPath(dir, name));
      }
      setNaming(null);
    });

  const crumbs = dir.split("/").filter(Boolean);

  return (
    <div className="flex h-full flex-col bg-[#0e131a]">
      <div className="space-y-2 border-b border-white/10 p-2.5">
        <ProgramHeader icon={Folder} color="#ffd27a" title="FILE EXPLORER" chip={<SourceChip>IndexedDB</SourceChip>} />
        <div className="flex items-center gap-1.5">
          <button aria-label="Up one folder" onClick={up} disabled={dir === "/"} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white/10 disabled:opacity-30">
            <ArrowLeft size={14} />
          </button>
          <nav aria-label="Path" className="mono flex h-8 min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-[8px] border border-white/10 bg-black px-2 text-[11px]">
            <button onClick={() => go("/")} className="text-white/60 hover:text-white">
              C:\
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1 whitespace-nowrap">
                <span className="text-white/30">\</span>
                <button onClick={() => go(`/${crumbs.slice(0, i + 1).join("/")}`)} className="hover:underline">
                  {c}
                </button>
              </span>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Btn icon={FolderPlus} onClick={() => setNaming({ kind: "folder", value: "" })}>
            Folder
          </Btn>
          <Btn icon={FilePlus} onClick={() => setNaming({ kind: "file", value: "" })}>
            File
          </Btn>
          <Btn
            icon={Upload}
            variant="soft"
            onClick={() =>
              attempt(async () => {
                const picked = await pickFiles({ multiple: true });
                for (const f of picked) await writeBytes(uniquePath(files, joinPath(dir, f.name)), new Uint8Array(await f.arrayBuffer()), f.type);
                if (picked.length) showToast(`Imported ${picked.length} file(s) into ${dir}`);
              })
            }
          >
            Import
          </Btn>
          <Btn icon={HardDrive} onClick={() => open("memory")}>
            Back up…
          </Btn>
        </div>
        {naming && (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void submitName();
            }}
          >
            <input
              autoFocus
              value={naming.value}
              onChange={(e) => setNaming({ ...naming, value: e.target.value })}
              placeholder={naming.kind === "folder" ? "folder name" : naming.kind === "file" ? "file name.md" : "new name"}
              className={`${inputClass} min-w-0 flex-1`}
              aria-label="Name"
            />
            <Btn type="submit" variant="soft">
              {naming.kind === "rename" ? "Rename" : "Create"}
            </Btn>
            <Btn onClick={() => setNaming(null)}>Cancel</Btn>
          </form>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {toast && <Notice>{toast}</Notice>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-2 overflow-auto p-2 sm:grid-cols-2">
        {loading && <div className="mono p-3 text-[11px] text-white/50">Loading files…</div>}
        {folders.map((name) => {
          const path = joinPath(dir, name);
          const count = files.filter((f) => isWithin(f.path, path) && basename(f.path) !== ".folder").length;
          return (
            <button
              key={name}
              onClick={() => (touch ? go(path) : setSelected(null))}
              onDoubleClick={() => go(path)}
              onKeyDown={(e) => e.key === "Enter" && go(path)}
              className="flex items-center gap-3 rounded-[12px] border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-white/15 hover:bg-white/[0.06]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#ffd27a]/20 bg-[#ffd27a]/15">
                {path === VAULT_DIR ? <Lock size={15} color="#ff5050" /> : <Folder size={16} color="#ffd27a" />}
              </div>
              <div className="min-w-0">
                <div className="mono truncate text-[11px]">{name}/</div>
                <div className="mono text-[9px] text-white/50">{count} file(s)</div>
              </div>
            </button>
          );
        })}
        {here.map((f) => {
          const sealed = isSealedPath(f.path) || f.path === META_PATH;
          return (
            <button
              key={f.path}
              onClick={() => {
                setSelected(f.path);
                setConfirmDelete(false);
                setPaper(null);
              }}
              onDoubleClick={() => openFile(f)}
              onKeyDown={(e) => e.key === "Enter" && openFile(f)}
              className={`flex items-center gap-3 rounded-[12px] border p-3 text-left transition ${
                selected === f.path ? "border-[#ffd27a]/40 bg-white/[0.07]" : "border-white/10 bg-white/[0.03] hover:border-white/15"
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.06]">
                {sealed ? <Lock size={14} color="#ff5050" /> : <FileText size={14} color="#8a9a95" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mono truncate text-[11px]">{sealed && f.path !== META_PATH ? "encrypted item" : basename(f.path)}</div>
                <div className="mono text-[9px] text-white/55">
                  {formatBytes(fileSize(f))} · {new Date(f.modified).toLocaleDateString()}
                  {!isText(f) && " · binary"}
                </div>
              </div>
            </button>
          );
        })}
        {!loading && folders.length === 0 && here.length === 0 && (
          <div className="mono col-span-full rounded-[12px] border border-dashed border-white/10 p-6 text-[11px] text-white/40">Empty folder. Import a file from your device or create one.</div>
        )}
      </div>

      {sel && (
        <div className="max-h-[50%] space-y-2 overflow-auto border-t border-white/10 bg-black/40 p-2.5">
          <div className="mono flex items-center justify-between gap-2 text-[10px]">
            <span className="truncate">{isSealedPath(sel.path) ? "Encrypted vault item (open the Vault to read it)" : sel.path}</span>
            <span className="shrink-0 text-white/50">
              {formatBytes(fileSize(sel))}
              {sel.mime ? ` · ${sel.mime}` : ""}
            </span>
          </div>
          {!isSealedPath(sel.path) && <Preview file={sel} />}
          <div className="flex flex-wrap gap-1.5">
            <Btn variant="soft" onClick={() => openFile(sel)}>
              Open
            </Btn>
            <Btn icon={Download} onClick={() => saveToDevice(basename(sel.path), fileBytes(sel), sel.mime || "application/octet-stream")}>
              Download
            </Btn>
            {!isSealedPath(sel.path) && sel.path !== META_PATH && (
              <>
                <Btn onClick={() => setNaming({ kind: "rename", value: basename(sel.path) })}>Rename</Btn>
                {fileSize(sel) <= PAPER_LIMIT && (
                  <Btn
                    icon={QrCode}
                    onClick={async () =>
                      setPaper(paper ? null : await encodeFragments({ kind: "file", data: { path: sel.path, content: sel.content, encoding: sel.encoding ?? "utf8", mime: sel.mime } }))
                    }
                  >
                    Paper
                  </Btn>
                )}
              </>
            )}
            {confirmDelete ? (
              <Btn
                variant="solid-danger"
                onClick={() =>
                  attempt(async () => {
                    await remove(sel.path);
                    setSelected(null);
                    setConfirmDelete(false);
                  })
                }
              >
                Delete forever?
              </Btn>
            ) : (
              <Btn variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Delete
              </Btn>
            )}
          </div>
          {paper && <QrSet title={basename(sel.path)} fragments={paper.fragments} hash={paper.hash} />}
        </div>
      )}

      <div className="mono flex h-8 shrink-0 items-center justify-between border-t border-white/10 px-3 text-[9px] text-white/55">
        <span>
          {files.filter((f) => basename(f.path) !== ".folder").length} files total · stored in this browser only
        </span>
        <span>{touch ? "tap to select" : "double-click to open"}</span>
      </div>
    </div>
  );
}
