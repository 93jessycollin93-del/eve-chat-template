import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { listFiles } from "../lib/fs";
import { complete, runCommand } from "../lib/shell";
import { requestPersistence, systemInfoLines } from "../lib/sysinfo";
import { useOs } from "../os/OsContext";
import { isProgramId, PROGRAMS, PROGRAM_IDS, type ProgramProps } from "../os/programs";

interface Line {
  text: string;
  kind?: "cmd" | "err" | "ok";
}

const HISTORY_KEY = "sf_terminal_history";

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export default function Terminal(_: ProgramProps) {
  const { open, hostName } = useOs();
  const [lines, setLines] = useState<Line[]>([
    { text: `Sovereign Foundry terminal — ${hostName}. Your files, for real. Type help.` },
    { text: "" },
  ]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState("/");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ prompt: string; run: () => Promise<string[]> } | null>(null);
  const history = useRef<string[]>(loadHistory());
  const histIndex = useRef<number>(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo(0, scroller.current.scrollHeight);
  }, [lines]);

  const print = (out: Line[]) => setLines((ls) => [...ls, ...out].slice(-600));
  const prompt = `${cwd === "/" ? "C:\\" : `C:${cwd.replace(/\//g, "\\")}`}>`;

  const submit = async () => {
    const line = input;
    setInput("");
    histIndex.current = -1;

    if (pending) {
      const yes = /^y(es)?$/i.test(line.trim());
      print([{ text: `${pending.prompt} ${line}`, kind: "cmd" }]);
      const job = pending;
      setPending(null);
      if (!yes) return print([{ text: "Cancelled. Nothing was deleted." }]);
      try {
        print((await job.run()).map((t) => ({ text: t, kind: "ok" as const })));
      } catch (err) {
        print([{ text: err instanceof Error ? err.message : String(err), kind: "err" }]);
      }
      return;
    }

    print([{ text: `${prompt} ${line}`, kind: "cmd" }]);
    if (!line.trim()) return;
    history.current = [...history.current.filter((h) => h !== line), line].slice(-200);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.current));
    } catch {
      /* ignore */
    }

    setBusy(true);
    try {
      const result = await runCommand(line, {
        cwd,
        host: hostName,
        history: history.current,
        open: (target, args) => {
          const id = target.replace(/\.exe$/, "");
          const match = isProgramId(id) ? id : PROGRAM_IDS.find((p) => PROGRAMS[p].short.toLowerCase() === id);
          if (!match) return false;
          open(match, args);
          return true;
        },
        systemInfo: () => systemInfoLines(hostName),
        requestPersistence,
      });
      if (result.clear) setLines([]);
      if (result.cwd) setCwd(result.cwd);
      print(result.output.map((t) => ({ text: t })));
      if (result.confirm) setPending(result.confirm);
    } catch (err) {
      print([{ text: err instanceof Error ? err.message : String(err), kind: "err" }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!busy) void submit();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const h = history.current;
      if (!h.length) return;
      let i = histIndex.current;
      if (e.key === "ArrowUp") i = i < 0 ? h.length - 1 : Math.max(0, i - 1);
      else i = i < 0 ? -1 : i + 1 >= h.length ? -1 : i + 1;
      histIndex.current = i;
      setInput(i < 0 ? "" : h[i]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      setInput(complete(input, await listFiles(), cwd));
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  };

  return (
    <div className="mono flex h-full flex-col bg-black p-3 text-[11px] text-accent" onClick={() => inputRef.current?.focus()}>
      <div ref={scroller} className="flex-1 overflow-auto leading-[16px] whitespace-pre-wrap select-text" role="log" aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className={l.kind === "err" ? "text-red-400" : l.kind === "cmd" ? "text-white/80" : l.kind === "ok" ? "text-accent" : ""}>
            {l.text || "\u00a0"}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-accent/20 pt-2">
        <span className="shrink-0 opacity-70">{pending ? "(y/n)" : prompt}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-accent outline-none"
          placeholder={pending ? "y or n" : "type help"}
          aria-label="Terminal command"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
        />
      </div>
      {pending && <div className="mt-1 text-[10px] text-gold">{pending.prompt}</div>}
    </div>
  );
}
