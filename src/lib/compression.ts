import { toArrayBuffer, toHex } from "./bytes";

export type CompressionFormatName = "gzip" | "deflate" | "deflate-raw";

export const COMPRESSION_FORMATS: { id: CompressionFormatName; ext: string; label: string }[] = [
  { id: "gzip", ext: "gz", label: "gzip (.gz) — opens with any unzip tool" },
  { id: "deflate", ext: "deflate", label: "deflate / zlib (.deflate)" },
  { id: "deflate-raw", ext: "raw", label: "raw deflate (.raw)" },
];

export function compressionSupported(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function compress(bytes: Uint8Array, format: CompressionFormatName = "deflate"): Promise<Uint8Array> {
  if (!compressionSupported()) throw new Error("This browser does not support the Compression Streams API");
  return pipe(bytes, new CompressionStream(format));
}

export async function decompress(bytes: Uint8Array, format: CompressionFormatName = "deflate"): Promise<Uint8Array> {
  if (!compressionSupported()) throw new Error("This browser does not support the Compression Streams API");
  try {
    return await pipe(bytes, new DecompressionStream(format));
  } catch (err) {
    throw new Error(`Not valid ${format} data (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
}

/** Guess the format from magic bytes: gzip starts 1f 8b, zlib starts 78 xx. */
export function sniffFormat(bytes: Uint8Array): CompressionFormatName | null {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) return "deflate";
  return null;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return toHex(new Uint8Array(digest));
}
