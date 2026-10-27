import { sha256Hex } from "./compression";
import type { FileRecord, Pod } from "./db";
import { fileBytes } from "./fs";
import { topLevel } from "./paths";

export interface IntegrityEntry {
  key: string;
  hash: string;
  bytes: number;
  group: string;
}

export interface IntegrityReport {
  /** SHA-256 over every entry's key and content hash, in sorted order. */
  root: string;
  entries: IntegrityEntry[];
  groups: { group: string; hash: string; count: number; bytes: number }[];
  totalBytes: number;
}

/** JSON with object keys sorted, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function combine(entries: IntegrityEntry[]): Promise<string> {
  return sha256Hex(entries.map((e) => `${e.key}\t${e.hash}\n`).join(""));
}

/**
 * Fingerprint every file and memory pod. Only content counts: timestamps are
 * ignored, so a backup restored elsewhere produces the same root.
 */
export async function computeIntegrity(
  files: Pick<FileRecord, "path" | "content" | "encoding">[],
  pods: Pod[],
): Promise<IntegrityReport> {
  const entries: IntegrityEntry[] = [];
  for (const f of files) {
    const bytes = fileBytes(f as FileRecord);
    entries.push({ key: `file:${f.path}`, hash: await sha256Hex(bytes), bytes: bytes.length, group: topLevel(f.path) || "/" });
  }
  for (const p of pods) {
    const json = canonicalJson(p);
    entries.push({
      key: `pod:${p.id}`,
      hash: await sha256Hex(json),
      bytes: new TextEncoder().encode(json).length,
      group: "Pods",
    });
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const byGroup = new Map<string, IntegrityEntry[]>();
  for (const e of entries) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
  const groups = await Promise.all(
    [...byGroup.entries()].map(async ([group, list]) => ({
      group,
      hash: await combine(list),
      count: list.length,
      bytes: list.reduce((n, e) => n + e.bytes, 0),
    })),
  );
  groups.sort((a, b) => a.group.localeCompare(b.group));

  return {
    root: await combine(entries),
    entries,
    groups,
    totalBytes: entries.reduce((n, e) => n + e.bytes, 0),
  };
}
