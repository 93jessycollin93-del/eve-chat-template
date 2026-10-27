import { FileText, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isText } from "../lib/fs";
import { basename } from "../lib/paths";
import { isSealedPath } from "../lib/vault";
import { useFiles } from "./hooks";
import { useOs } from "./OsContext";
import { PROGRAM_IDS, PROGRAMS, type ProgramId } from "./programs";

type Result =
  | { kind: "program"; id: ProgramId; label: string; sub: string }
  | { kind: "file"; path: string; label: string; sub: string };

export function Launcher() {
  const { setLauncherOpen, open } = useOs();
  const { files } = useFiles();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const programs: Result[] = PROGRAM_IDS.filter((id) => {
      if (!q) return true;
      const p = PROGRAMS[id];
      return `${p.title} ${p.short} ${p.desc} ${p.keywords}`.toLowerCase().includes(q);
    }).map((id) => ({ kind: "program", id, label: PROGRAMS[id].title, sub: PROGRAMS[id].desc }));
    if (!q) return programs;
    const fileHits: Result[] = [];
    for (const f of files) {
      if (basename(f.path) === ".folder" || isSealedPath(f.path)) continue;
      if (f.path.toLowerCase().includes(q)) {
        fileHits.push({ kind: "file", path: f.path, label: basename(f.path), sub: f.path });
      } else if (isText(f)) {
        const at = f.content.toLowerCase().indexOf(q);
        if (at >= 0) {
          const snippet = f.content.slice(Math.max(0, at - 30), at + q.length + 40).replace(/\s+/g, " ");
          fileHits.push({ kind: "file", path: f.path, label: basename(f.path), sub: `${f.path} — …${snippet}…` });
        }
      }
      if (fileHits.length >= 30) break;
    }
    return [...programs, ...fileHits];
  }, [query, files]);

  const choose = (r: Result | undefined) => {
    if (!r) return;
    if (r.kind === "program") open(r.id);
    else open("theorypad", { path: r.path });
    setLauncherOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center bg-black/50 px-3 pt-[12vh] backdrop-blur-sm"
      onPointerDown={(e) => e.target === e.currentTarget && setLauncherOpen(false)}
    >
      <div role="dialog" aria-label="Search" className="w-full max-w-[560px] overflow-hidden rounded-[16px] border border-white/15 bg-[#101821]/95 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-3">
          <Search size={15} className="text-white/50" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setLauncherOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") choose(results[index]);
            }}
            placeholder="Search programs and the contents of your files…"
            aria-label="Search programs and files"
            className="mono h-12 flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/35"
          />
          <kbd className="mono rounded border border-white/15 px-1.5 text-[9px] text-white/40">esc</kbd>
        </div>
        <ul className="max-h-[55vh] overflow-auto p-1.5" role="listbox">
          {results.length === 0 && <li className="mono p-3 text-[11px] text-white/40">Nothing matches “{query}”.</li>}
          {results.map((r, i) => {
            const Icon = r.kind === "program" ? PROGRAMS[r.id].icon : FileText;
            const color = r.kind === "program" ? PROGRAMS[r.id].color : "#8a9a95";
            return (
              <li key={r.kind === "program" ? r.id : r.path} role="option" aria-selected={i === index}>
                <button
                  onClick={() => choose(r)}
                  onMouseEnter={() => setIndex(i)}
                  className={`flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left ${i === index ? "bg-white/[0.08]" : ""}`}
                >
                  <Icon size={15} color={color} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">{r.label}</span>
                    <span className="mono block truncate text-[10px] text-white/45">{r.sub}</span>
                  </span>
                  <span className="mono text-[9px] text-white/30">{r.kind === "program" ? "open" : "edit"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
