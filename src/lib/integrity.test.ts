import { describe, expect, it } from "vitest";
import type { FileRecord, Pod } from "./db";
import { canonicalJson, computeIntegrity } from "./integrity";

const f = (path: string, content: string, t = 1): FileRecord => ({ path, content, encoding: "utf8", created: t, modified: t });
const pod: Pod = { id: "p1", timestamp: "2025-01-01", summary: "s", fullText: { user: "u", assistant: "a" }, model: "m", endpoint: "e" };

describe("integrity", () => {
  it("ignores order and timestamps, but not content", async () => {
    const a = await computeIntegrity([f("/x", "1"), f("/y/z", "2")], [pod]);
    const b = await computeIntegrity([f("/y/z", "2", 99), f("/x", "1", 50)], [{ ...pod }]);
    expect(a.root).toBe(b.root);
    expect(a.root).toMatch(/^[0-9a-f]{64}$/);
    const c = await computeIntegrity([f("/x", "1!"), f("/y/z", "2")], [pod]);
    expect(c.root).not.toBe(a.root);
    expect(a.groups.map((g) => g.group)).toEqual(["/", "Pods", "y"]);
  });

  it("canonicalizes JSON key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});
