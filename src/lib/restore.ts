import { listFiles, putMany, uniquePath, type FileRecord } from "./fs";
import { normalizePath } from "./paths";
import { isPod, putPods, type Pod } from "./pods";

export type QrPayload = { kind: "pod"; data: Pod } | { kind: "file"; data: Pick<FileRecord, "path" | "content" | "encoding" | "mime"> };

/** Restores whatever a paper backup carried. Returns a human-readable summary. */
export async function restoreQrPayload(value: unknown): Promise<string> {
  // The original artifact put a bare pod object in its QR codes.
  if (isPod(value)) {
    await putPods([value]);
    return `Restored memory pod “${value.summary.slice(0, 60)}”.`;
  }
  const v = value as { kind?: unknown; data?: unknown } | null;
  if (v?.kind === "pod" && isPod(v.data)) {
    await putPods([v.data]);
    return `Restored memory pod “${v.data.summary.slice(0, 60)}”.`;
  }
  if (v?.kind === "file" && v.data && typeof v.data === "object") {
    const d = v.data as Record<string, unknown>;
    if (typeof d.path !== "string" || typeof d.content !== "string") throw new Error("The file in this backup is malformed.");
    const files = await listFiles();
    const wanted = normalizePath(d.path);
    const same = files.find((f) => f.path === wanted);
    if (same && same.content === d.content) return `${wanted} is already here, unchanged.`;
    const path = same ? uniquePath(files, wanted) : wanted;
    const now = Date.now();
    await putMany([
      { path, content: d.content, encoding: d.encoding === "base64" ? "base64" : "utf8", mime: typeof d.mime === "string" ? d.mime : undefined, created: now, modified: now },
    ]);
    return same ? `Restored to ${path} (kept your current ${wanted}).` : `Restored ${path}.`;
  }
  throw new Error("These codes decoded fine, but contain something Foundry does not recognize.");
}
