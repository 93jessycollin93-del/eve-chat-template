import { toArrayBuffer } from "./bytes";

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: { suggestedName: string }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

export interface SaveResult {
  method: "picker" | "download" | "cancelled";
  bytes: number;
}

/**
 * Saves a file to the user's device. Uses the File System Access save dialog
 * where the browser has it (Chromium desktop), otherwise a normal download.
 */
export async function saveToDevice(name: string, data: Uint8Array | string, type = "application/octet-stream"): Promise<SaveResult> {
  const blob = new Blob([typeof data === "string" ? data : toArrayBuffer(data)], { type });
  const w = window as unknown as SaveFilePickerWindow;
  if (w.showSaveFilePicker && window.self === window.top) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: "picker", bytes: blob.size };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return { method: "cancelled", bytes: 0 };
      // Any other failure (e.g. SecurityError): fall back to a plain download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { method: "download", bytes: blob.size };
}

/** Opens the native file picker and resolves with the chosen files (empty if cancelled). */
export function pickFiles(opts: { accept?: string; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (opts.accept) input.accept = opts.accept;
    input.multiple = !!opts.multiple;
    input.style.display = "none";
    input.onchange = () => {
      resolve(input.files ? [...input.files] : []);
      input.remove();
    };
    input.addEventListener("cancel", () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function backupFileName(date = new Date()): string {
  return `sovereign_backup_${date.toISOString().slice(0, 10)}.json`;
}
