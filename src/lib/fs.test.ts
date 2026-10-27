import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { copy, fileBytes, fileSize, listDir, listFiles, mkdir, move, readFile, remove, uniquePath, writeBytes, writeText } from "./fs";

beforeEach(resetDbForTests);

describe("fs", () => {
  it("writes, reads and keeps created time on rewrite", async () => {
    const first = await writeText("/Notes/a.md", "héllo");
    expect(fileSize(first)).toBe(6);
    await new Promise((r) => setTimeout(r, 5));
    const second = await writeText("/Notes/a.md", "changed");
    expect(second.created).toBe(first.created);
    expect(second.modified).toBeGreaterThan(first.created);
    expect((await readFile("Notes/a.md"))?.content).toBe("changed");
  });

  it("stores binary files as base64 and text as text", async () => {
    const bin = await writeBytes("/img.bin", new Uint8Array([0, 255, 1, 2]), "application/octet-stream");
    expect(bin.encoding).toBe("base64");
    expect(fileBytes(bin)).toEqual(new Uint8Array([0, 255, 1, 2]));
    expect(fileSize(bin)).toBe(4);
    const txt = await writeBytes("/t.txt", new TextEncoder().encode("plain"));
    expect(txt.encoding).toBe("utf8");
    expect(txt.content).toBe("plain");
  });

  it("lists folders, hides folder markers", async () => {
    await writeText("/A/one.txt", "1");
    await writeText("/A/B/two.txt", "2");
    await mkdir("/Empty");
    const files = await listFiles();
    expect(listDir(files, "/")).toMatchObject({ folders: ["A", "Empty"], files: [] });
    const a = listDir(files, "/A");
    expect(a.folders).toEqual(["B"]);
    expect(a.files.map((f) => f.path)).toEqual(["/A/one.txt"]);
    expect(listDir(files, "/Empty").files).toEqual([]);
  });

  it("moves into folders, renames, copies, and removes trees", async () => {
    await writeText("/A/one.txt", "1");
    await writeText("/A/B/two.txt", "2");
    await mkdir("/Dest");
    await move("/A/one.txt", "/Dest");
    expect(await readFile("/Dest/one.txt")).toBeTruthy();
    await move("/A", "/Renamed");
    expect(await readFile("/Renamed/B/two.txt")).toBeTruthy();
    expect(await readFile("/A/B/two.txt")).toBeUndefined();
    await copy("/Renamed", "/Copy");
    expect((await readFile("/Copy/B/two.txt"))?.content).toBe("2");
    await expect(move("/Copy", "/Copy/inner")).rejects.toThrow(/inside itself/);
    await expect(copy("/Renamed/B/two.txt", "/Copy/B/two.txt")).rejects.toThrow(/Already exists/);
    expect(await remove("/Copy")).toBe(1);
    expect((await listFiles()).some((f) => f.path.startsWith("/Copy"))).toBe(false);
  });

  it("finds a free name", async () => {
    await writeText("/a.txt", "x");
    await writeText("/a (2).txt", "x");
    expect(uniquePath(await listFiles(), "/a.txt")).toBe("/a (3).txt");
  });
});
