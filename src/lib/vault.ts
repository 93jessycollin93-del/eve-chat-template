import { randomId } from "./bytes";
import type { FileEncoding, FileRecord } from "./db";
import { applyBatch, FOLDER_MARKER, listFiles, readFile } from "./fs";
import { basename, isWithin } from "./paths";
import { createVaultMeta, DEFAULT_ITERATIONS, isVaultMeta, seal, unseal, type Sealed, type VaultMeta } from "./vault-crypto";

export const VAULT_DIR = "/Vault";
export const META_PATH = "/Vault/.vault.json";
export const SEALED_EXT = ".sealed";

/** What is inside a sealed file. The real file name is encrypted too. */
export interface VaultEntry {
  name: string;
  content: string;
  encoding: FileEncoding;
  mime?: string;
  created: number;
  modified: number;
}

export interface VaultItem {
  id: string;
  path: string;
  entry: VaultEntry | null;
  error?: string;
}

interface SealedFile extends Sealed {
  v: 1;
}

export function readMeta(files: FileRecord[]): VaultMeta | null {
  const rec = files.find((f) => f.path === META_PATH);
  if (!rec) return null;
  try {
    const parsed = JSON.parse(rec.content);
    return isVaultMeta(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSealedPath(path: string): boolean {
  return isWithin(path, VAULT_DIR) && path.endsWith(SEALED_EXT);
}

/** Files sitting in /Vault unencrypted (e.g. seeds, or files written there by the terminal). */
export function plaintextVaultFiles(files: FileRecord[]): FileRecord[] {
  return files.filter(
    (f) =>
      isWithin(f.path, VAULT_DIR) &&
      f.path !== META_PATH &&
      !f.path.endsWith(SEALED_EXT) &&
      basename(f.path) !== FOLDER_MARKER,
  );
}

function sealedPath(id: string): string {
  return `${VAULT_DIR}/${id}${SEALED_EXT}`;
}

async function sealEntry(key: CryptoKey, id: string, entry: VaultEntry): Promise<FileRecord> {
  const sealed: SealedFile = { v: 1, ...(await seal(key, JSON.stringify(entry))) };
  const now = Date.now();
  return { path: sealedPath(id), content: JSON.stringify(sealed), encoding: "utf8", created: now, modified: now };
}

function entryFromPlain(f: FileRecord): VaultEntry {
  return {
    name: f.path.slice(VAULT_DIR.length + 1),
    content: f.content,
    encoding: f.encoding ?? "utf8",
    mime: f.mime,
    created: f.created,
    modified: f.modified,
  };
}

function metaRecord(meta: VaultMeta): FileRecord {
  const now = Date.now();
  return { path: META_PATH, content: JSON.stringify(meta, null, 2), encoding: "utf8", created: now, modified: now };
}

/**
 * Creates the vault and encrypts every plaintext file already in /Vault.
 * One atomic write: the plaintext is only removed if the ciphertext is stored.
 */
export async function setupVault(passphrase: string, iterations = DEFAULT_ITERATIONS): Promise<CryptoKey> {
  const files = await listFiles();
  if (readMeta(files)) throw new Error("The vault is already set up");
  const { meta, key } = await createVaultMeta(passphrase, iterations);
  const plain = plaintextVaultFiles(files);
  const puts = [metaRecord(meta)];
  for (const f of plain) puts.push(await sealEntry(key, randomId(), entryFromPlain(f)));
  await applyBatch(puts, plain.map((f) => f.path));
  return key;
}

/** Encrypts plaintext files that appeared in /Vault after setup. */
export async function sealPlaintext(key: CryptoKey): Promise<number> {
  const plain = plaintextVaultFiles(await listFiles());
  const puts: FileRecord[] = [];
  for (const f of plain) puts.push(await sealEntry(key, randomId(), entryFromPlain(f)));
  await applyBatch(puts, plain.map((f) => f.path));
  return plain.length;
}

export async function listItems(key: CryptoKey): Promise<VaultItem[]> {
  const files = (await listFiles()).filter((f) => isSealedPath(f.path));
  const items: VaultItem[] = [];
  for (const f of files) {
    const id = basename(f.path).slice(0, -SEALED_EXT.length);
    try {
      const sealed = JSON.parse(f.content) as SealedFile;
      items.push({ id, path: f.path, entry: JSON.parse(await unseal(key, sealed)) as VaultEntry });
    } catch {
      items.push({ id, path: f.path, entry: null, error: "Cannot decrypt (damaged, or sealed with another passphrase)" });
    }
  }
  return items.sort((a, b) => (a.entry?.name ?? "~").localeCompare(b.entry?.name ?? "~"));
}

export async function saveItem(key: CryptoKey, id: string | null, entry: VaultEntry): Promise<string> {
  const itemId = id ?? randomId();
  const existing = await readFile(sealedPath(itemId));
  const rec = await sealEntry(key, itemId, entry);
  if (existing) rec.created = existing.created;
  await applyBatch([rec], []);
  return itemId;
}

export async function deleteItem(id: string): Promise<void> {
  await applyBatch([], [sealedPath(id)]);
}

/** Re-encrypts everything under a new passphrase, atomically. */
export async function changePassphrase(
  key: CryptoKey,
  newPassphrase: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<CryptoKey> {
  const items = await listItems(key);
  const broken = items.filter((i) => !i.entry);
  if (broken.length) throw new Error(`${broken.length} item(s) cannot be decrypted; fix or delete them first`);
  const { meta, key: newKey } = await createVaultMeta(newPassphrase, iterations);
  const puts = [metaRecord(meta)];
  for (const item of items) puts.push(await sealEntry(newKey, item.id, item.entry!));
  await applyBatch(puts, []);
  return newKey;
}
