/**
 * Base45 (RFC 9285). Its 45-character alphabet is exactly the QR "alphanumeric"
 * character set, so Base45 text packs densely into QR codes.
 */
export const BASE45_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export function base45Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = bytes[i] * 256 + bytes[i + 1];
      const c = n % 45;
      n = Math.floor(n / 45);
      out += BASE45_CHARSET[c] + BASE45_CHARSET[n % 45] + BASE45_CHARSET[Math.floor(n / 45)];
    } else {
      const n = bytes[i];
      out += BASE45_CHARSET[n % 45] + BASE45_CHARSET[Math.floor(n / 45)];
    }
  }
  return out;
}

export function base45Decode(text: string): Uint8Array {
  const values: number[] = [];
  for (const ch of text) {
    const v = BASE45_CHARSET.indexOf(ch);
    if (v < 0) throw new Error(`Invalid Base45 character "${ch}"`);
    values.push(v);
  }
  if (values.length % 3 === 1) throw new Error("Invalid Base45 length");
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 3) {
    if (i + 2 < values.length) {
      const n = values[i] + values[i + 1] * 45 + values[i + 2] * 2025;
      if (n > 0xffff) throw new Error("Invalid Base45 triplet");
      out.push(n >> 8, n & 0xff);
    } else {
      const n = values[i] + values[i + 1] * 45;
      if (n > 0xff) throw new Error("Invalid Base45 pair");
      out.push(n);
    }
  }
  return new Uint8Array(out);
}
