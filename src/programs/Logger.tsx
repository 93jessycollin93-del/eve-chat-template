import { Download, Pencil, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { randomId } from "../lib/bytes";
import { saveToDevice } from "../lib/download";
import { JOURNAL_PATH, journalToMarkdown, parseJournal, saveJournal, type JournalEntry } from "../lib/journal";
import { useFiles, useLocalSetting } from "../os/hooks";
import type { ProgramProps } from "../os/programs";
import { Btn, inputClass, Notice, ProgramHeader, SourceChip } from "../ui/ui";

type Side = "brutal" | "beautiful";

export default function Logger(_: ProgramProps) {
  const { files, loading } = useFiles();
  const [sideSetting, setSide] = useLocalSetting("sf_logger_side", "brutal");
  const side: Side = sideSetting === "beautiful" ? "beautiful" : "brutal";
  const other: Side = side === "brutal" ? "beautiful" : "brutal";
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; side: Side; text: string } | null>(null);
  const [error, setError] = useState("");

  const raw = files.find((f) => f.path === JOURNAL_PATH)?.content ?? "";
  const entries = useMemo(() => parseJournal(raw), [raw]);
  const reframed = entries.filter((e) => e.brutal && e.beautiful).length;

  const persist = async (next: JournalEntry[]) => {
    try {
      await saveJournal(next);
      setError("");
    } catch (err) {
      setError(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    const entry: JournalEntry = { id: randomId(6), t: new Date().toISOString(), brutal: "", beautiful: "" };
    entry[side] = text;
    setDraft("");
    await persist([entry, ...entries]);
  };

  const saveEdit = async () => {
    if (!editing) return;
    await persist(entries.map((e) => (e.id === editing.id ? { ...e, [editing.side]: editing.text.trim() } : e)));
    setEditing(null);
  };

  const accent = side === "brutal" ? "text-[#ff8a8a]" : "text-[#c0ffde]";

  return (
    <div className="flex h-full flex-col bg-[#111017] p-3">
      <ProgramHeader icon={Scale} color="#a78bfa" title="BRUTAL / BEAUTIFUL LOGGER" chip={<SourceChip>{JOURNAL_PATH}</SourceChip>}>
        <span className="mono text-[9px] text-white/60">{side.toUpperCase()}</span>
        <button
          role="switch"
          aria-checked={side === "beautiful"}
          aria-label="Show beautiful side"
          onClick={() => setSide(other)}
          className={`flex h-[26px] w-[50px] rounded-full p-1 transition ${side === "beautiful" ? "justify-end bg-accent/30" : "justify-start bg-white/10"}`}
        >
          <span className={`h-[18px] w-[18px] rounded-full shadow ${side === "beautiful" ? "bg-accent" : "bg-white"}`} />
        </button>
      </ProgramHeader>

      <div className="mono mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/50">
        <span>
          {entries.length} entries · {reframed} with both truths
        </span>
        <Btn icon={Download} disabled={!entries.length} onClick={() => saveToDevice("brutal_beautiful_journal.md", journalToMarkdown(entries), "text/markdown")}>
          Export .md
        </Btn>
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {loading && <div className="mono text-[11px] text-white/40">Loading journal…</div>}
        {!loading && entries.length === 0 && (
          <div className="mono rounded-[12px] border border-dashed border-white/10 p-4 text-[11px] text-white/45">
            Write a brutal truth. Later, flip the switch and write its beautiful side. Entries are saved to {JOURNAL_PATH}.
          </div>
        )}
        {entries.map((e) => {
          const text = e[side];
          const isEditing = editing?.id === e.id;
          return (
            <article key={e.id} className="rounded-[12px] border border-white/10 bg-white/[0.04] p-3">
              <div className="mono flex items-center justify-between text-[9px] text-white/50">
                <time dateTime={e.t}>{new Date(e.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time>
                <div className="flex items-center gap-1">
                  <span>{e.brutal && e.beautiful ? "both truths" : `${side === "brutal" ? "BRUTAL" : "BEAUTIFUL"}_TRUTH.sys`}</span>
                  {!isEditing && (
                    <>
                      <button aria-label="Edit" className="rounded p-1 hover:bg-white/10" onClick={() => setEditing({ id: e.id, side, text })}>
                        <Pencil size={11} />
                      </button>
                      <button aria-label="Delete entry" className="rounded p-1 hover:bg-red-500/20" onClick={() => confirm("Delete this entry?") && void persist(entries.filter((x) => x.id !== e.id))}>
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    autoFocus
                    value={editing.text}
                    onChange={(ev) => setEditing({ ...editing, text: ev.target.value })}
                    className="mono h-[70px] w-full resize-y rounded-[8px] border border-white/10 bg-black p-2 text-[12px] outline-none focus:border-violet/40"
                    aria-label={`${editing.side} truth`}
                  />
                  <div className="flex gap-1.5">
                    <Btn variant="soft" onClick={() => void saveEdit()}>
                      Save
                    </Btn>
                    <Btn onClick={() => setEditing(null)}>Cancel</Btn>
                  </div>
                </div>
              ) : text ? (
                <p className={`mono mt-2 text-[12px] leading-5 whitespace-pre-wrap ${accent}`}>{text}</p>
              ) : (
                <div className="mt-2">
                  <p className="mono text-[11px] text-white/40 italic">Only the {other} side is written: “{e[other].slice(0, 120)}”</p>
                  <button className="mono mt-1 text-[10px] text-violet underline" onClick={() => setEditing({ id: e.id, side, text: "" })}>
                    Write the {side} side
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={side === "brutal" ? "Log a brutal truth…" : "Log a beautiful truth…"}
          className={`${inputClass} h-10 flex-1`}
          aria-label="New entry"
        />
        <button type="submit" disabled={!draft.trim()} className="mono h-10 rounded-[10px] bg-violet px-4 text-[11px] font-semibold text-black disabled:opacity-40">
          Log
        </button>
      </form>
    </div>
  );
}
