export const DB_NAME = "cybernetic_fs";
const DB_VERSION = 2;

export type FileEncoding = "utf8" | "base64";

export interface FileRecord {
  path: string;
  /** UTF-8 text, or base64 when `encoding` is "base64" (binary files). */
  content: string;
  encoding?: FileEncoding;
  mime?: string;
  created: number;
  modified: number;
}

export interface Pod {
  id: string;
  timestamp: string;
  summary: string;
  fullText: { user: string; assistant: string };
  model: string;
  endpoint: string;
}

type StoreName = "files" | "pods";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "path" });
      if (!db.objectStoreNames.contains("pods")) db.createObjectStore("pods", { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: close so it is not blocked.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab. Close other Foundry tabs and reload."));
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getOne<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Applies puts and deletes in one atomic transaction: all succeed or none do. */
export async function batch<T>(store: StoreName, puts: T[], deletes: string[] = []): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const key of deletes) os.delete(key);
  for (const value of puts) os.put(value);
  await done(tx);
}

export async function clearStore(store: StoreName): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).clear();
  await done(tx);
}

/** Test helper: drop the cached connection and delete the database. */
export async function resetDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
