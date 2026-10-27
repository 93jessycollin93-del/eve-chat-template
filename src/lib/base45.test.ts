import { describe, expect, it } from "vitest";
import { base45Decode, base45Encode } from "./base45";

const enc = (s: string) => base45Encode(new TextEncoder().encode(s));
const dec = (s: string) => new TextDecoder().decode(base45Decode(s));

describe("base45 (RFC 9285 test vectors)", () => {
  it("encodes", () => {
    expect(enc("AB")).toBe("BB8");
    expect(enc("Hello!!")).toBe("%69 VD92EX0");
    expect(enc("base-45")).toBe("UJCLQE7W581");
  });

  it("decodes", () => {
    expect(dec("QED8WEX0")).toBe("ietf!");
    expect(dec("%69 VD92EX0")).toBe("Hello!!");
  });

  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37 + 11) % 256);
    expect(base45Decode(base45Encode(bytes))).toEqual(bytes);
  });

  it("rejects invalid input", () => {
    expect(() => base45Decode("GGW")).toThrow(); // 65535+ overflow
    expect(() => base45Decode("a")).toThrow();
    expect(() => base45Decode("AAAA")).toThrow(); // length % 3 == 1
  });
});
