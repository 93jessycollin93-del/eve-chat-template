import { Box, Download, FolderInput, Save, Upload } from "lucide-react";
import { useState } from "react";
import { formatBytes, toHex, tryDecodeText, utf8Encode } from "../lib/bytes";
import { COMPRESSION_FORMATS, compress, compressionSupported, decompress, sha256Hex, sniffFormat, type CompressionFormatName } from "../lib/compression";
import { pickFiles, saveToDevice } from "../lib/download";
import { fileBytes, isMarker, uniquePath, writeBytes } from "../lib/fs";
import { basename } from "../lib/paths";
import { isSealedPath } from "../lib/vault";
import { useFiles, useToast } from "../os/hooks";
import type { ProgramProps } from "../os/programs";
import { Btn, Card, inputClass, Notice, ProgramHeader, SourceChip, Stat } from "../ui/ui";

interface Source {
  name: string;
  bytes: Uint8Array;
}

interface CompressResult {
  name: string;
  format: CompressionFormatName;
  original: number;
  packed: Uint8Array;
  ms: number;
  sha: string;
}

interface DecompressResult {
  name: string;
  format: CompressionFormatName;
  input: number;
  output: Uint8Array;
  ms: number;
  sha: string;
  text: string | null;
}

function Ratio({ original, packed }: { original: number; packed: number }) {
  const pct = original ? Math.min(100, (packed / original) * 100) : 0;
  return (
    <div className="space-y-1.5" aria-label={`Compressed to ${pct.toFixed(1)} percent of original`}>
      <div className="mono flex justify-between text-[9px] text-white/50">
        <span>original {formatBytes(original)}</span>
        <span>compressed {formatBytes(packed)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-white/30" style={{ width: "100%" }} />
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(pct, 0.5)}%` }} />
      </div>
    </div>
  );
}

export default function Compression(_: ProgramProps) {
  const { files } = useFiles();
  const [mode, setMode] = useState<"compress" | "decompress">("compress");
  const [format, setFormat] = useState<CompressionFormatName>("gzip");
  const [text, setText] = useState("Information = Compressed Experience\nUniverse compresses 13.8B years into 12KB of theory.\n");
  const [fsPick, setFsPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CompressResult | null>(null);
  const [unpacked, setUnpacked] = useState<DecompressResult | null>(null);
  const [toast, showToast] = useToast();

  const candidates = files.filter((f) => !isMarker(f) && !isSealedPath(f.path));
  const supported = compressionSupported();

  const fromFs = (path: string): Source | null => {
    const f = files.find((x) => x.path === path);
    return f ? { name: basename(f.path), bytes: fileBytes(f) } : null;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doCompress = (src: Source) =>
    run(async () => {
      const t0 = performance.now();
      const packed = await compress(src.bytes, format);
      const ms = performance.now() - t0;
      setResult({ name: src.name, format, original: src.bytes.length, packed, ms, sha: await sha256Hex(src.bytes) });
    });

  const doDecompress = (src: Source) =>
    run(async () => {
      const detected = sniffFormat(src.bytes) ?? format;
      const t0 = performance.now();
      const output = await decompress(src.bytes, detected);
      const ms = performance.now() - t0;
      setUnpacked({ name: src.name, format: detected, input: src.bytes.length, output, ms, sha: await sha256Hex(output), text: tryDecodeText(output) });
    });

  const ext = COMPRESSION_FORMATS.find((f) => f.id === format)?.ext ?? "bin";
  const outName = (name: string, e: string) => (name === "text" ? `compressed.txt.${e}` : `${name}.${e}`);
  const restoredName = (name: string) => name.replace(/\.(gz|deflate|raw)$/i, "") || "restored.bin";

  const saveToFoundry = async (name: string, bytes: Uint8Array, dir: string) => {
    const path = uniquePath(files, `${dir}/${name}`);
    await writeBytes(path, bytes);
    showToast(`Saved ${formatBytes(bytes.length)} to ${path}`);
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-[#0b1310] p-3 [&>*]:shrink-0">
      <ProgramHeader icon={Box} color="#00FF88" title="COMPRESSION_ENGINE.SYS" chip={<SourceChip>CompressionStream</SourceChip>} />
      {!supported && <Notice tone="danger">This browser does not support the Compression Streams API, so nothing here can run. Try a current Chrome, Edge, Firefox or Safari.</Notice>}

      <div className="flex flex-wrap gap-1.5">
        <Btn variant={mode === "compress" ? "soft" : "ghost"} onClick={() => setMode("compress")}>
          Compress
        </Btn>
        <Btn variant={mode === "decompress" ? "soft" : "ghost"} onClick={() => setMode("decompress")}>
          Decompress &amp; verify
        </Btn>
        <select value={format} onChange={(e) => setFormat(e.target.value as CompressionFormatName)} className={`${inputClass} min-w-0 flex-1 text-[11px]`} aria-label="Format">
          {COMPRESSION_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {mode === "compress" ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mono h-[90px] w-full shrink-0 resize-y rounded-[10px] border border-white/10 bg-black p-2 text-[11px] text-[#c8ffe3] outline-none focus:border-accent/40"
            placeholder="Type or paste text to compress…"
            aria-label="Text to compress"
          />
          <div className="flex flex-wrap gap-1.5">
            <Btn variant="primary" disabled={busy || !supported} onClick={() => doCompress({ name: "text", bytes: utf8Encode(text) })}>
              {busy ? "Working…" : "Compress text"}
            </Btn>
            <Btn icon={Upload} disabled={busy || !supported} onClick={async () => {
              const [f] = await pickFiles();
              if (f) await doCompress({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
            }}>
              From device
            </Btn>
            <select value={fsPick} onChange={(e) => setFsPick(e.target.value)} className={`${inputClass} min-w-0 flex-1 text-[11px]`} aria-label="Foundry file">
              <option value="">Foundry file…</option>
              {candidates.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
            <Btn icon={FolderInput} disabled={!fsPick || busy || !supported} onClick={() => {
              const s = fromFs(fsPick);
              if (s) void doCompress(s);
            }}>
              Compress
            </Btn>
          </div>
          {result && (
            <Card className="space-y-3">
              <Ratio original={result.original} packed={result.packed.length} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Original" value={formatBytes(result.original)} />
                <Stat label="Compressed" value={formatBytes(result.packed.length)} />
                <Stat label="Saved" value={`${result.original ? Math.max(0, 100 - (result.packed.length / result.original) * 100).toFixed(1) : 0}%`} hint={result.packed.length > result.original ? "tiny inputs can grow" : undefined} />
                <Stat label="Time" value={`${result.ms.toFixed(1)} ms`} hint={result.format} />
              </div>
              <div className="mono text-[9px] leading-4 break-all text-white/55">
                <div>SHA-256 of original: {result.sha}</div>
                <div className="mt-1">First bytes: {toHex(result.packed.subarray(0, 32)).replace(/(..)/g, "$1 ")}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Btn icon={Download} onClick={async () => {
                  const r = await saveToDevice(outName(result.name, ext), result.packed);
                  if (r.method !== "cancelled") showToast(`Saved ${formatBytes(r.bytes)} to your device`);
                }}>
                  Save to device
                </Btn>
                <Btn icon={Save} onClick={() => saveToFoundry(outName(result.name, ext), result.packed, "/Compressed")}>
                  Save to /Compressed
                </Btn>
              </div>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="mono text-[10px] text-white/55">gzip and zlib files are detected automatically; raw deflate uses the format chosen above.</div>
          <div className="flex flex-wrap gap-1.5">
            <Btn icon={Upload} variant="primary" disabled={busy || !supported} onClick={async () => {
              const [f] = await pickFiles();
              if (f) await doDecompress({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
            }}>
              Pick compressed file
            </Btn>
            <select value={fsPick} onChange={(e) => setFsPick(e.target.value)} className={`${inputClass} min-w-0 flex-1 text-[11px]`} aria-label="Foundry file">
              <option value="">Foundry file…</option>
              {candidates.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
            <Btn icon={FolderInput} disabled={!fsPick || busy || !supported} onClick={() => {
              const s = fromFs(fsPick);
              if (s) void doDecompress(s);
            }}>
              Decompress
            </Btn>
          </div>
          {unpacked && (
            <Card className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Input" value={formatBytes(unpacked.input)} hint={unpacked.name} />
                <Stat label="Restored" value={formatBytes(unpacked.output.length)} />
                <Stat label="Format" value={unpacked.format} />
                <Stat label="Time" value={`${unpacked.ms.toFixed(1)} ms`} />
              </div>
              {result && result.sha === unpacked.sha ? (
                <Notice>VERIFIED — restored bytes are identical to what you compressed (SHA-256 match).</Notice>
              ) : (
                <Notice tone="muted">Decompressed cleanly; the format's built-in checksum passed. SHA-256: {unpacked.sha}</Notice>
              )}
              {unpacked.text !== null && (
                <pre className="mono max-h-[140px] overflow-auto rounded-[8px] border border-white/10 bg-black p-2 text-[10px] whitespace-pre-wrap text-white/80">
                  {unpacked.text.slice(0, 4000)}
                  {unpacked.text.length > 4000 ? "\n…" : ""}
                </pre>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Btn icon={Download} onClick={() => saveToDevice(restoredName(unpacked.name), unpacked.output)}>
                  Save to device
                </Btn>
                <Btn icon={Save} onClick={() => saveToFoundry(restoredName(unpacked.name), unpacked.output, "/Restored")}>
                  Save to /Restored
                </Btn>
              </div>
            </Card>
          )}
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {toast && <Notice>{toast}</Notice>}
    </div>
  );
}
