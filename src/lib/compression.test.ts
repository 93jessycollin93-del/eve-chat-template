import { describe, expect, it } from "vitest";
import { compress, decompress, sha256Hex, sniffFormat } from "./compression";

describe("compression", () => {
  it("round-trips each format and sniffs headers", async () => {
    const input = new TextEncoder().encode("Information = Compressed Experience\n".repeat(50));
    for (const format of ["gzip", "deflate", "deflate-raw"] as const) {
      const packed = await compress(input, format);
      expect(packed.length).toBeLessThan(input.length);
      expect(await decompress(packed, format)).toEqual(input);
      if (format !== "deflate-raw") expect(sniffFormat(packed)).toBe(format);
    }
  });

  it("rejects corrupt data with a clear error", async () => {
    await expect(decompress(new Uint8Array([1, 2, 3, 4]), "gzip")).rejects.toThrow(/Not valid gzip/);
  });

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
