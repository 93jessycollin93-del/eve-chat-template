import { randomId } from "./bytes";
import { readFile, writeText } from "./fs";

/**
 * The Brutal/Beautiful journal: each entry pairs a hard truth with its reframe.
 * Stored as JSON Lines in a normal file, so it is backed up, hashed, and
 * readable from the terminal like everything else.
 */
export const JOURNAL_PATH = "/Logs/brutal_beautiful.jsonl";

export interface JournalEntry {
  id: string;
  t: string;
  brutal: string;
  beautiful: string;
}

export function parseJournal(text: string): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<JournalEntry>;
      if (typeof e.t !== "string") continue;
      out.push({
        id: typeof e.id === "string" ? e.id : randomId(4),
        t: e.t,
        brutal: typeof e.brutal === "string" ? e.brutal : "",
        beautiful: typeof e.beautiful === "string" ? e.beautiful : "",
      });
    } catch {
      /* skip a damaged line instead of losing the whole journal */
    }
  }
  return out.sort((a, b) => b.t.localeCompare(a.t));
}

export function serializeJournal(entries: JournalEntry[]): string {
  return [...entries]
    .sort((a, b) => a.t.localeCompare(b.t))
    .map((e) => JSON.stringify({ id: e.id, t: e.t, brutal: e.brutal, beautiful: e.beautiful }))
    .join("\n")
    .concat(entries.length ? "\n" : "");
}

export async function loadJournal(): Promise<JournalEntry[]> {
  const rec = await readFile(JOURNAL_PATH);
  return rec ? parseJournal(rec.content) : [];
}

export async function saveJournal(entries: JournalEntry[]): Promise<void> {
  await writeText(JOURNAL_PATH, serializeJournal(entries));
}

export function journalToMarkdown(entries: JournalEntry[]): string {
  const lines = ["# Brutal / Beautiful journal", ""];
  for (const e of [...entries].sort((a, b) => a.t.localeCompare(b.t))) {
    lines.push(`## ${new Date(e.t).toLocaleString()}`, "");
    lines.push(`**Brutal:** ${e.brutal || "_(not written yet)_"}`, "");
    lines.push(`**Beautiful:** ${e.beautiful || "_(not written yet)_"}`, "");
  }
  return lines.join("\n");
}
