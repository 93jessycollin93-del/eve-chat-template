import type { FileEncoding, FileRecord, Pod } from "./db";
import { fileSize, listFiles } from "./fs";
import { computeIntegrity } from "./integrity";
import { isWithin, normalizePath } from "./paths";
import { isPod, listPods } from "./pods";

export const BACKUP_FORMAT = "sovereign-foundry-backup";

export interface BackupFile {
  path: string;
  content: string;
  encoding?: FileEncoding;
  mime?: string;
  size: number;
  created: number;
  modified: number;
}

export interface BackupV2 {
  format: typeof BACKUP_FORMAT;
  version: 2;
  exportedAt: string;
  app: { version: string; commit: string };
  files: BackupFile[];
  pods: Pod[];
  stats: { fileBytes: number; podCount: number; totalFiles: number; rootHash: string };
}

export interface ParsedBackup {
  version: 1 | 2;
  files: FileRecord[];
  pods: Pod[];
  exportedAt?: string;
  /** null for v1 backups, which carry no fingerprint to check against. */
  verified: boolean | null;
  expectedRoot?: string;
  actualRoot: string;
}

export async function buildBackup(files: FileRecord[], pods: Pod[], app = { version: "", commit: "" }): Promise<BackupV2> {
  const report = await computeIntegrity(files, pods);
  return {
    format: BACKUP_FORMAT,
    version: 2,
    exportedAt: new Date().toISOString(),
    app,
    files: files.map((f) => ({
      path: f.path,
      content: f.content,
      encoding: f.encoding ?? "utf8",
      mime: f.mime,
      size: fileSize(f),
      created: f.created,
      modified: f.modified,
    })),
    pods,
    stats: {
      fileBytes: files.reduce((n, f) => n + fileSize(f), 0),
      podCount: pods.length,
      totalFiles: files.length,
      rootHash: report.root,
    },
  };
}

export async function buildBackupFromDisk(app?: { version: string; commit: string }): Promise<BackupV2> {
  return buildBackup(await listFiles(), await listPods(), app);
}

function toFileRecord(raw: unknown, index: number): FileRecord {
  if (!raw || typeof raw !== "object") throw new Error(`File #${index + 1} is not an object`);
  const f = raw as Record<string, unknown>;
  if (typeof f.path !== "string" || typeof f.content !== "string") {
    throw new Error(`File #${index + 1} is missing a path or content`);
  }
  const path = normalizePath(f.path);
  if (path === "/") throw new Error(`File #${index + 1} has an invalid path`);
  const encoding: FileEncoding = f.encoding === "base64" ? "base64" : "utf8";
  const now = Date.now();
  return {
    path,
    content: f.content,
    encoding,
    mime: typeof f.mime === "string" ? f.mime : undefined,
    created: typeof f.created === "number" ? f.created : now,
    modified: typeof f.modified === "number" ? f.modified : now,
  };
}

/** Accepts v2 backups and the original artifact's v1 `cybernetic_backup_*.json`. */
export async function parseBackup(text: string): Promise<ParsedBackup> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON");
  }
  if (!data || typeof data !== "object") throw new Error("Not a backup file");
  const d = data as Record<string, unknown>;
  if (d.version !== 1 && d.version !== 2) throw new Error("Unknown backup version");
  if (!Array.isArray(d.files)) throw new Error("Backup has no file list");

  const files = d.files.map(toFileRecord);
  const rawPods = Array.isArray(d.pods) ? d.pods : [];
  const pods = rawPods.filter(isPod);
  if (pods.length !== rawPods.length) throw new Error(`${rawPods.length - pods.length} memory pod(s) are malformed`);

  const report = await computeIntegrity(files, pods);
  if (d.version === 1) {
    return { version: 1, files, pods, verified: null, actualRoot: report.root, exportedAt: d.exportedAt as string };
  }
  const stats = d.stats as Record<string, unknown> | undefined;
  const expected = typeof stats?.rootHash === "string" ? stats.rootHash : undefined;
  return {
    version: 2,
    files,
    pods,
    exportedAt: typeof d.exportedAt === "string" ? d.exportedAt : undefined,
    verified: expected ? expected === report.root : false,
    expectedRoot: expected,
    actualRoot: report.root,
  };
}

export interface RestorePlan {
  files: FileRecord[];
  pods: Pod[];
  /** Existing files whose content would change. */
  overwrites: number;
  /** Vault files left out because they belong to a different vault than this device's. */
  skippedVault: number;
}

/**
 * Decide what a restore will write. If this device already has a vault and the
 * backup's vault was sealed with a different passphrase (different salt), the
 * backup's vault files are skipped: writing its metadata would orphan every
 * item sealed on this device.
 */
export function planRestore(current: FileRecord[], backup: Pick<ParsedBackup, "files" | "pods">): RestorePlan {
  const META = "/Vault/.vault.json";
  const salt = (recs: FileRecord[]) => {
    const m = recs.find((f) => f.path === META);
    try {
      return m ? (JSON.parse(m.content) as { salt?: string }).salt ?? null : null;
    } catch {
      return null;
    }
  };
  const mine = salt(current);
  const theirs = salt(backup.files);
  const conflict = mine !== null && theirs !== null && mine !== theirs;
  const files = conflict ? backup.files.filter((f) => !isWithin(f.path, "/Vault")) : backup.files;
  return {
    files,
    pods: backup.pods,
    overwrites: files.filter((p) => current.some((f) => f.path === p.path && f.content !== p.content)).length,
    skippedVault: backup.files.length - files.length,
  };
}

// The last-backup marker lives in localStorage (same keys as the original artifact).
export function getLastBackup(): { at: string; bytes: number } | null {
  try {
    const at = localStorage.getItem("last_backup_at");
    if (!at) return null;
    return { at, bytes: Number(localStorage.getItem("last_backup_bytes") || 0) };
  } catch {
    return null;
  }
}

export function setLastBackup(at: string, bytes: number): void {
  try {
    localStorage.setItem("last_backup_at", at);
    localStorage.setItem("last_backup_bytes", String(bytes));
  } catch {
    /* storage unavailable: the backup file itself still exists */
  }
}
