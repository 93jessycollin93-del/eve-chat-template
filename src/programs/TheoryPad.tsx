import { Download, FilePlus, FileText, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, utf8Encode } from "../lib/bytes";
import { pickFiles, saveToDevice } from "../lib/download";
import { fileSize, isMarker, isText, readFile, uniquePath, writeBytes, writeText } from "../lib/fs";
import { basename, normalizePath } from "../lib/paths";
import { isSealedPath, META_PATH } from "../lib/vault";
import { useFiles, useToast } from "../os/hooks";
import { useOs } from "../os/OsContext";
import type { ProgramProps } from "../os/programs";
import { Btn, inputClass, Notice, ProgramHeader, SourceChip } from "../ui/ui";

const DEFAULT_PATH = "/Theory/cybernetic_theory.md";
type SaveState = "saved" | "dirty" | "saving" | "error";

export default function TheoryPad({ args }: ProgramProps) {
  const { files, loading } = useFiles();
  const { open } = useOs();
  const [path, setPath] = useState(args?.path ?? DEFAULT_PATH);
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [binary, setBinary] = useState(false);
  const [state, setState] = useState<SaveState>("saved");
  const [newName, setNewName] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const pending = useRef<{ path: string; content: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const job = pending.current;
    pending.current = null;
    if (!job) return;
    setState("saving");
    try {
      await writeText(job.path, job.content);
      setState(pending.current ? "dirty" : "saved");
    } catch {
      setState("error");
    }
  }, []);

  // Follow requests from other programs ("open this file").
  useEffect(() => {
    if (args?.path && args.path !== path) {
      void flush();
      setPath(args.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to new launch args
  }, [args?.path]);

  // Load the file when the path changes.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    readFile(path).then((rec) => {
      if (cancelled) return;
      setMissing(!rec);
      setBinary(!!rec && !isText(rec));
      setContent(rec && isText(rec) ? rec.content : "");
      setState("saved");
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Pick up edits made elsewhere (terminal, another tab) when there is nothing unsaved here.
  useEffect(() => {
    if (!loaded || state !== "saved") return;
    const rec = files.find((f) => f.path === path);
    if (rec && isText(rec) && rec.content !== content) setContent(rec.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content is intentionally read, not watched
  }, [files]);

  // Save on close.
  useEffect(() => () => void flush(), [flush]);

  const onChange = (value: string) => {
    setContent(value);
    setMissing(false);
    setState("dirty");
    pending.current = { path, content: value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 400);
  };

  const current = files.find((f) => f.path === path);
  const textFiles = files.filter((f) => isText(f) && !isMarker(f) && !isSealedPath(f.path) && f.path !== META_PATH);
  const words = content.split(/\s+/).filter(Boolean).length;
  const bytes = utf8Encode(content).length;

  const createFile = async (name: string) => {
    const clean = name.trim();
    if (!clean) return setNewName(null);
    const target = uniquePath(files, normalizePath(clean.includes("/") ? clean : `/Theory/${clean}`));
    await flush();
    await writeText(target, "");
    setNewName(null);
    setPath(target);
  };

  return (
    <div className="flex h-full flex-col gap-2 bg-[#10100a] p-3">
      <ProgramHeader
        icon={FileText}
        color="#ffe66a"
        title={path}
        chip={<SourceChip>IndexedDB</SourceChip>}
      >
        <SourceChip tone={state === "saved" ? "muted" : state === "error" ? "danger" : "warn"}>
          {state === "saved" ? "saved" : state === "saving" ? "saving…" : state === "dirty" ? "unsaved" : "save failed"}
        </SourceChip>
      </ProgramHeader>

      <div className="flex flex-wrap gap-1.5">
        <select
          value={textFiles.some((f) => f.path === path) ? path : ""}
          onChange={async (e) => {
            if (!e.target.value) return;
            await flush();
            setPath(e.target.value);
          }}
          className={`${inputClass} min-w-0 flex-1 text-[11px]`}
          aria-label="Open file"
        >
          {!textFiles.some((f) => f.path === path) && <option value="">{basename(path)} (new)</option>}
          {textFiles.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
        {newName === null ? (
          <Btn icon={FilePlus} onClick={() => setNewName("")}>
            New
          </Btn>
        ) : (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void createFile(newName);
            }}
          >
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="name.md" className={`${inputClass} w-[140px]`} aria-label="New file name" />
            <Btn type="submit" variant="soft">
              Create
            </Btn>
          </form>
        )}
        <Btn
          icon={Upload}
          onClick={async () => {
            const picked = await pickFiles({ multiple: true });
            let last = "";
            for (const f of picked) {
              last = uniquePath(files, `/Theory/${f.name}`);
              await writeBytes(last, new Uint8Array(await f.arrayBuffer()), f.type);
            }
            if (last) {
              await flush();
              setPath(last);
              showToast(`Imported ${picked.length} file(s) into /Theory`);
            }
          }}
        >
          Import
        </Btn>
        <Btn
          icon={Download}
          disabled={binary}
          onClick={async () => {
            await flush();
            const r = await saveToDevice(basename(path), content, "text/plain;charset=utf-8");
            if (r.method !== "cancelled") showToast(`Exported ${formatBytes(r.bytes)} to your device`);
          }}
        >
          Export
        </Btn>
      </div>

      {toast && <Notice>{toast}</Notice>}
      {binary ? (
        <Notice tone="warn">
          {basename(path)} is a binary file{current ? ` (${formatBytes(fileSize(current))})` : ""}. Open it from File Explorer to download it.
          {"\n"}
          <button className="underline" onClick={() => open("explorer")}>
            Open File Explorer
          </button>
        </Notice>
      ) : !loaded || loading ? (
        <div className="mono p-4 text-[11px] text-white/50">Loading…</div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => void flush()}
          placeholder={missing ? "This file does not exist yet. Start typing to create it." : ""}
          className="mono min-h-0 w-full flex-1 resize-none rounded-[10px] border border-white/10 bg-black p-3 text-[12px] leading-[19px] text-[#e8e3c8] outline-none focus:border-gold/30"
          spellCheck={false}
          aria-label={`Contents of ${path}`}
        />
      )}
      <div className="mono flex justify-between text-[9px] text-white/45">
        <span>
          {bytes.toLocaleString()} bytes · {words.toLocaleString()} words · {content ? content.split("\n").length : 0} lines
        </span>
        <span>autosaves 0.4s after you stop typing</span>
      </div>
    </div>
  );
}
