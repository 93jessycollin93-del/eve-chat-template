import { base45Decode, base45Encode } from "./base45";
import { utf8Decode, utf8Encode } from "./bytes";
import { compress, decompress, sha256Hex } from "./compression";

/**
 * Paper backups: JSON -> deflate -> Base45 -> split into numbered fragments,
 * one QR code each. Format: `SF1:<i>/<n>:<HASH8>:<base45 chunk>*`.
 * Every character is in the QR alphanumeric set, so codes stay small. Base45
 * can end in a space, so the trailing `*` keeps copy/paste trimming harmless.
 *
 * Also reads the original artifact's `F|<i>/<n>|<djb2>|<chunk>` text format.
 */

export const FRAGMENT_CHARS = 400;

export interface FragmentSet {
  fragments: string[];
  hash: string;
  bytes: number;
}

export interface ParsedFragment {
  index: number;
  total: number;
  hash: string;
  payload: string;
  legacy: boolean;
}

/** djb2 hash used by the original artifact's QR format (4 hex chars). */
export function legacyHash(text: string): string {
  let n = 5381;
  for (let i = 0; i < text.length; i++) n = ((n << 5) + n + text.charCodeAt(i)) & 0xffffffff;
  return (n >>> 0).toString(16).padStart(4, "0").slice(-4);
}

async function shortHash(text: string): Promise<string> {
  return (await sha256Hex(text)).slice(0, 8).toUpperCase();
}

export async function encodeFragments(value: unknown, chunkChars = FRAGMENT_CHARS): Promise<FragmentSet> {
  const json = JSON.stringify(value);
  const packed = base45Encode(await compress(utf8Encode(json), "deflate"));
  const hash = await shortHash(packed);
  const chunks: string[] = [];
  for (let i = 0; i < packed.length; i += chunkChars) chunks.push(packed.slice(i, i + chunkChars));
  if (chunks.length === 0) chunks.push("");
  return {
    fragments: chunks.map((c, i) => `SF1:${i + 1}/${chunks.length}:${hash}:${c}*`),
    hash,
    bytes: utf8Encode(json).length,
  };
}

export function parseFragment(line: string): ParsedFragment | null {
  const text = line.trim();
  const modern = /^SF1:(\d+)\/(\d+):([0-9A-F]{8}):(.*)\*$/s.exec(text);
  if (modern) {
    return { index: +modern[1], total: +modern[2], hash: modern[3], payload: modern[4], legacy: false };
  }
  // Old fragments have no end marker, so only strip line endings from the right.
  const legacy = /^F\|(\d+)\/(\d+)\|([a-f0-9]+)\|(.*)$/is.exec(line.trimStart().replace(/[\r\n]+$/, ""));
  if (legacy) {
    return { index: +legacy[1], total: +legacy[2], hash: legacy[3].toLowerCase(), payload: legacy[4], legacy: true };
  }
  return null;
}

/** Collects fragments (from paste, camera, or photos) until a set is complete. */
export class FragmentCollector {
  private parts = new Map<number, ParsedFragment>();
  hash: string | null = null;
  total = 0;

  /** Returns a short status message describing what happened. */
  add(line: string): string {
    const frag = parseFragment(line);
    if (!frag) return "Not a Foundry backup code";
    if (frag.index < 1 || frag.index > frag.total) return "Fragment number is out of range";
    if (this.hash && frag.hash !== this.hash) {
      return `Belongs to a different backup (${frag.hash}, collecting ${this.hash})`;
    }
    this.hash = frag.hash;
    this.total = frag.total;
    const fresh = !this.parts.has(frag.index);
    this.parts.set(frag.index, frag);
    return fresh ? `Got ${frag.index}/${frag.total}` : `Already have ${frag.index}/${frag.total}`;
  }

  get count(): number {
    return this.parts.size;
  }

  get complete(): boolean {
    return this.total > 0 && this.parts.size === this.total;
  }

  missing(): number[] {
    const out: number[] = [];
    for (let i = 1; i <= this.total; i++) if (!this.parts.has(i)) out.push(i);
    return out;
  }

  reset(): void {
    this.parts.clear();
    this.hash = null;
    this.total = 0;
  }

  async decode(): Promise<unknown> {
    if (!this.complete) throw new Error(`Missing fragments: ${this.missing().join(", ")}`);
    const ordered = [...this.parts.values()].sort((a, b) => a.index - b.index);
    const packed = ordered.map((p) => p.payload).join("");
    const legacy = ordered[0].legacy;
    const actual = legacy ? legacyHash(packed) : await shortHash(packed);
    if (actual !== this.hash) throw new Error(`Checksum mismatch: expected ${this.hash}, got ${actual}. A fragment is damaged.`);
    const json = utf8Decode(await decompress(base45Decode(packed), "deflate"));
    return JSON.parse(json);
  }
}

export async function decodeFragments(lines: string[]): Promise<unknown> {
  const c = new FragmentCollector();
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = c.add(line);
    if (msg.startsWith("Belongs") || msg.startsWith("Fragment number")) throw new Error(msg);
  }
  if (c.total === 0) throw new Error("No backup fragments found");
  return c.decode();
}
