import { base64ToBytes, bytesToBase64, tryDecodeText, utf8Encode } from "./bytes";
import { batch, getAll, getOne, type FileRecord } from "./db";
import { basename, dirname, isWithin, joinPath, normalizePath } from "./paths";

export type { FileRecord } from "./db";

/** Empty marker file that keeps an otherwise-empty folder alive. */
export const FOLDER_MARKER = ".folder";

// ---------------------------------------------------------------------------
// Change notifications (this tab + other tabs on the same origin)
// ---------------------------------------------------------------------------

export const fsEvents = new EventTarget();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel("sovereign-fs");
  channel.onmessage = () => fsEvents.dispatchEvent(new Event("change"));
  return channel;
}

export function notifyChange(): void {
  fsEvents.dispatchEvent(new Event("change"));
  getChannel()?.postMessage("change");
}

/** Start listening for changes made in other tabs. */
export function startSync(): void {
  getChannel();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listFiles(): Promise<FileRecord[]> {
  const all = await getAll<FileRecord>("files");
  return all.sort((a, b) => a.path.localeCompare(b.path));
}

export function readFile(path: string): Promise<FileRecord | undefined> {
  return getOne<FileRecord>("files", normalizePath(path));
}

export function isMarker(rec: FileRecord): boolean {
  return basename(rec.path) === FOLDER_MARKER;
}

export function fileBytes(rec: FileRecord): Uint8Array {
  return rec.encoding === "base64" ? base64ToBytes(rec.content) : utf8Encode(rec.content);
}

export function fileSize(rec: FileRecord): number {
  if (rec.encoding === "base64") {
    const pad = rec.content.endsWith("==") ? 2 : rec.content.endsWith("=") ? 1 : 0;
    return Math.floor((rec.content.length * 3) / 4) - pad;
  }
  return utf8Encode(rec.content).length;
}

export function isText(rec: FileRecord): boolean {
  return rec.encoding !== "base64";
}

export function isDirectory(files: FileRecord[], path: string): boolean {
  const p = normalizePath(path);
  if (p === "/") return true;
  return files.some((f) => f.path.startsWith(`${p}/`));
}

export interface DirListing {
  folders: string[];
  files: FileRecord[];
}

export function listDir(files: FileRecord[], dir: string): DirListing {
  const d = normalizePath(dir);
  const prefix = d === "/" ? "/" : `${d}/`;
  const folders = new Set<string>();
  const here: FileRecord[] = [];
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash >= 0) folders.add(rest.slice(0, slash));
    else if (rest !== FOLDER_MARKER) here.push(f);
  }
  return {
    folders: [...folders].sort((a, b) => a.localeCompare(b)),
    files: here.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function assertWritablePath(path: string): string {
  const p = normalizePath(path);
  if (p === "/") throw new Error("Cannot write to the root folder itself");
  if (basename(p).length > 255) throw new Error("File name is too long");
  return p;
}

export async function writeText(path: string, content: string): Promise<FileRecord> {
  const p = assertWritablePath(path);
  const existing = await readFile(p);
  const now = Date.now();
  const rec: FileRecord = {
    path: p,
    content,
    encoding: "utf8",
    mime: existing?.encoding !== "base64" ? existing?.mime : undefined,
    created: existing?.created ?? now,
    modified: now,
  };
  await batch("files", [rec]);
  notifyChange();
  return rec;
}

/** Store raw bytes: kept as text when they are valid UTF-8, otherwise as base64. */
export async function writeBytes(path: string, bytes: Uint8Array, mime?: string): Promise<FileRecord> {
  const p = assertWritablePath(path);
  const existing = await readFile(p);
  const now = Date.now();
  const text = tryDecodeText(bytes);
  const rec: FileRecord = {
    path: p,
    content: text ?? bytesToBase64(bytes),
    encoding: text === null ? "base64" : "utf8",
    mime: mime || undefined,
    created: existing?.created ?? now,
    modified: now,
  };
  await batch("files", [rec]);
  notifyChange();
  return rec;
}

export async function putMany(records: FileRecord[]): Promise<void> {
  await batch(
    "files",
    records.map((r) => ({ ...r, path: assertWritablePath(r.path) })),
  );
  notifyChange();
}

export async function applyBatch(puts: FileRecord[], deletes: string[]): Promise<void> {
  await batch("files", puts, deletes);
  notifyChange();
}

export async function mkdir(path: string): Promise<void> {
  const p = assertWritablePath(path);
  const marker = joinPath(p, FOLDER_MARKER);
  if (await readFile(marker)) return;
  const now = Date.now();
  await batch("files", [{ path: marker, content: "", encoding: "utf8", created: now, modified: now }]);
  notifyChange();
}

/** Removes a file, or a folder and everything inside it. Returns how many records were deleted. */
export async function remove(path: string): Promise<number> {
  const p = assertWritablePath(path);
  const all = await listFiles();
  const doomed = all.filter((f) => isWithin(f.path, p)).map((f) => f.path);
  if (doomed.length === 0) return 0;
  await batch("files", [], doomed);
  notifyChange();
  return doomed.filter((d) => basename(d) !== FOLDER_MARKER).length;
}

async function relocate(src: string, dst: string, keepSource: boolean): Promise<number> {
  const from = assertWritablePath(src);
  let to = assertWritablePath(dst);
  const all = await listFiles();
  const affected = all.filter((f) => isWithin(f.path, from));
  if (affected.length === 0) throw new Error(`No such file or folder: ${from}`);

  // `mv a.txt Folder` moves into an existing folder, like a shell would.
  const single = affected.length === 1 && affected[0].path === from;
  if (isDirectory(all, to) && !(single && to === from)) to = joinPath(to, basename(from));
  if (isWithin(to, from) && to !== from) throw new Error("Cannot move a folder inside itself");
  if (to === from) return 0;

  const now = Date.now();
  const puts = affected.map((f) => ({
    ...f,
    path: to + f.path.slice(from.length),
    modified: keepSource ? now : f.modified,
    created: keepSource ? now : f.created,
  }));
  const clash = puts.find((p) => all.some((f) => f.path === p.path));
  if (clash) throw new Error(`Already exists: ${clash.path}`);
  await batch("files", puts, keepSource ? [] : affected.map((f) => f.path));
  notifyChange();
  return affected.filter((f) => basename(f.path) !== FOLDER_MARKER).length;
}

export function move(src: string, dst: string): Promise<number> {
  return relocate(src, dst, false);
}

export function copy(src: string, dst: string): Promise<number> {
  return relocate(src, dst, true);
}

/** Pick a free path like "/Folder/name (2).txt" when the requested one is taken. */
export function uniquePath(files: FileRecord[], wanted: string): string {
  const p = normalizePath(wanted);
  if (!files.some((f) => f.path === p)) return p;
  const dir = dirname(p);
  const name = basename(p);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = joinPath(dir, `${stem} (${i})${ext}`);
    if (!files.some((f) => f.path === candidate)) return candidate;
  }
}
