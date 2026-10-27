import { describe, expect, it } from "vitest";
import { buildBackup, parseBackup, planRestore } from "./backup";
import type { FileRecord, Pod } from "./db";

const files: FileRecord[] = [
  { path: "/a.txt", content: "alpha", encoding: "utf8", created: 1, modified: 2 },
  { path: "/bin/x", content: "AP8BAg==", encoding: "base64", mime: "application/octet-stream", created: 1, modified: 2 },
];
const pods: Pod[] = [{ id: "p", timestamp: "t", summary: "s", fullText: { user: "u", assistant: "a" }, model: "m", endpoint: "e" }];

describe("backups", () => {
  it("verifies an untouched v2 backup", async () => {
    const backup = await buildBackup(files, pods, { version: "1.0.0", commit: "abc" });
    expect(backup.stats.totalFiles).toBe(2);
    expect(backup.stats.fileBytes).toBe(9);
    const parsed = await parseBackup(JSON.stringify(backup));
    expect(parsed.verified).toBe(true);
    expect(parsed.files[1].encoding).toBe("base64");
    expect(parsed.pods).toHaveLength(1);
  });

  it("flags a tampered v2 backup", async () => {
    const backup = await buildBackup(files, pods);
    backup.files[0].content = "tampered";
    const parsed = await parseBackup(JSON.stringify(backup));
    expect(parsed.verified).toBe(false);
    expect(parsed.actualRoot).not.toBe(parsed.expectedRoot);
  });

  it("imports the original artifact's v1 backups", async () => {
    const v1 = {
      version: 1,
      exportedAt: "2025-01-01T00:00:00.000Z",
      files: [{ path: "/Theory/t.md", content: "theory", size: 6, created: 5, modified: 6 }],
      pods,
      stats: { fileBytes: 6, podCount: 1, totalFiles: 1 },
    };
    const parsed = await parseBackup(JSON.stringify(v1));
    expect(parsed.version).toBe(1);
    expect(parsed.verified).toBeNull();
    expect(parsed.files[0]).toMatchObject({ path: "/Theory/t.md", encoding: "utf8", created: 5 });
  });

  it("rejects junk", async () => {
    await expect(parseBackup("nope")).rejects.toThrow(/JSON/);
    await expect(parseBackup('{"version":3,"files":[]}')).rejects.toThrow(/version/);
    await expect(parseBackup('{"version":2,"files":[{"path":1}]}')).rejects.toThrow(/missing/);
  });

  it("never lets a restore orphan this device's vault", () => {
    const meta = (salt: string): FileRecord => ({ path: "/Vault/.vault.json", content: JSON.stringify({ salt }), encoding: "utf8", created: 1, modified: 1 });
    const sealed: FileRecord = { path: "/Vault/abc.sealed", content: "{}", encoding: "utf8", created: 1, modified: 1 };
    const incoming = { files: [meta("THEIRS"), sealed, files[0]], pods: [] };
    const conflict = planRestore([meta("MINE")], incoming);
    expect(conflict.skippedVault).toBe(2);
    expect(conflict.files.map((f) => f.path)).toEqual(["/a.txt"]);
    // Same vault (same salt), or no vault here yet: everything is restored.
    expect(planRestore([meta("THEIRS")], incoming).skippedVault).toBe(0);
    expect(planRestore([], incoming).files).toHaveLength(3);
    expect(planRestore([{ ...files[0], content: "old" }], incoming).overwrites).toBe(1);
  });
});
