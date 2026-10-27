import { describe, expect, it } from "vitest";
import { base45Encode } from "./base45";
import { compress } from "./compression";
import { decodeFragments, encodeFragments, FragmentCollector, legacyHash, parseFragment } from "./qrbackup";

const BASE45_OR_HEADER = /^[0-9A-Z $%*+\-./:]+$/;

describe("qr paper backups", () => {
  it("round-trips through fragments that fit the QR alphanumeric set", async () => {
    const value = { kind: "pod", data: { text: "x".repeat(3000) + "🌱 é", n: [1, 2, 3] } };
    const set = await encodeFragments(value, 100);
    expect(set.fragments.length).toBeGreaterThan(0);
    for (const frag of set.fragments) expect(frag).toMatch(BASE45_OR_HEADER);
    expect(await decodeFragments([...set.fragments].reverse())).toEqual(value);
    // Pasting may add or strip surrounding whitespace; the end marker protects real spaces.
    expect(await decodeFragments(set.fragments.map((f) => `  ${f}  \r`))).toEqual(value);
  });

  it("splits large payloads into several fragments", async () => {
    const random = Array.from({ length: 2000 }, (_, i) => ((i * 7919) % 9973).toString(36)).join("");
    const set = await encodeFragments({ random }, 200);
    expect(set.fragments.length).toBeGreaterThan(3);
    const c = new FragmentCollector();
    c.add(set.fragments[0]);
    expect(c.complete).toBe(false);
    expect(c.missing()).toContain(2);
    set.fragments.slice(1).forEach((s) => c.add(s));
    expect(c.complete).toBe(true);
    expect(await c.decode()).toEqual({ random });
  });

  it("detects a damaged fragment", async () => {
    const set = await encodeFragments({ a: Array.from({ length: 300 }, (_, i) => i * 31).join(",") }, 60);
    expect(set.fragments.length).toBeGreaterThan(1);
    const flip = (s: string) => {
      const i = s.length - 10;
      return s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    };
    const bad = set.fragments.map((s, i) => (i === 1 ? flip(s) : s));
    await expect(decodeFragments(bad)).rejects.toThrow(/Checksum mismatch/);
  });

  it("rejects fragments from two different backups", async () => {
    const a = await encodeFragments({ a: 1 });
    const b = await encodeFragments({ b: 2 });
    await expect(decodeFragments([a.fragments[0], b.fragments[0]])).rejects.toThrow(/different backup/);
  });

  it("reads the original artifact's F| text format", async () => {
    const pod = { id: "old", summary: "legacy pod" };
    const packed = base45Encode(await compress(new TextEncoder().encode(JSON.stringify(pod)), "deflate"));
    const hash = legacyHash(packed);
    const half = Math.ceil(packed.length / 2);
    const lines = [`F|1/2|${hash}|${packed.slice(0, half)}`, `F|2/2|${hash}|${packed.slice(half)}`];
    expect(parseFragment(lines[0])?.legacy).toBe(true);
    expect(await decodeFragments(lines)).toEqual(pod);
  });
});
