import jsQR from "jsqr";
import { Camera, Download, ImageUp, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { saveToDevice } from "../lib/download";
import { FragmentCollector } from "../lib/qrbackup";
import { Btn, Notice } from "./ui";

export function QrCanvas({ text, size = 180 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, text, { errorCorrectionLevel: "M", margin: 2, width: size * 2 }).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [text, size]);
  if (error) return <div className="mono w-[180px] text-[9px] text-red-300">QR failed: {error}</div>;
  return <canvas ref={ref} style={{ width: size, height: size }} className="rounded-[6px] bg-white" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** A printable HTML page with every QR code plus the text fragments as a fallback. */
export async function saveQrSheet(title: string, fragments: string[], hash: string): Promise<void> {
  const images = await Promise.all(fragments.map((f) => QRCode.toDataURL(f, { errorCorrectionLevel: "M", margin: 2, width: 360 })));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:ui-monospace,monospace;margin:24px;color:#000}h1{font-size:16px}.grid{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0;text-align:center;page-break-inside:avoid}img{width:220px;height:220px}figcaption{font-size:11px}
pre{white-space:pre-wrap;word-break:break-all;font-size:8px;border-top:1px solid #999;margin-top:24px;padding-top:8px}</style></head>
<body><h1>${escapeHtml(title)}</h1><p>Sovereign Foundry paper backup · checksum ${hash} · ${fragments.length} code(s) · made ${new Date().toLocaleString()}.<br>
Restore: Memory Map → Restore from paper → scan each code (any order), or paste the text lines below.</p>
<div class="grid">${images.map((src, i) => `<figure><img src="${src}" alt="code ${i + 1}"><figcaption>${i + 1} / ${fragments.length}</figcaption></figure>`).join("")}</div>
<pre>${fragments.map(escapeHtml).join("\n")}</pre></body></html>`;
  await saveToDevice(`${title.replace(/[^a-z0-9-_]+/gi, "_")}.html`, html, "text/html");
}

export function QrSet({ title, fragments, hash }: { title: string; fragments: string[]; hash: string }) {
  return (
    <div className="space-y-2 rounded-[10px] border border-accent/20 bg-black p-2.5">
      <div className="mono text-[9px] text-accent">
        deflate + Base45 · checksum {hash} · {fragments.length} code(s) · scan in any order
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {fragments.map((f, i) => (
          <figure key={i} className="flex shrink-0 flex-col items-center gap-1">
            <QrCanvas text={f} size={140} />
            <figcaption className="mono text-[9px] text-white/60">
              {i + 1}/{fragments.length}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Btn icon={Download} variant="soft" onClick={() => void saveQrSheet(title, fragments, hash)}>
          Save printable sheet
        </Btn>
        <Btn
          onClick={async () => {
            await navigator.clipboard?.writeText(fragments.join("\n")).catch(() => {});
          }}
        >
          Copy as text
        </Btn>
      </div>
    </div>
  );
}

async function decodeImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

/**
 * Collects backup fragments from the camera, photos, or pasted text, then
 * hands the decoded value to `onComplete`.
 */
export function QrRestore({ onComplete }: { onComplete: (value: unknown) => Promise<string> }) {
  const collector = useRef(new FragmentCollector());
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState({ have: 0, total: 0 });
  const [scanning, setScanning] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ tone: "accent" | "danger"; msg: string } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const feed = async (data: string) => {
    const msg = collector.current.add(data);
    setStatus(msg);
    setProgress({ have: collector.current.count, total: collector.current.total });
    if (collector.current.complete) {
      stop();
      try {
        const value = await collector.current.decode();
        setResult({ tone: "accent", msg: await onComplete(value) });
      } catch (err) {
        setResult({ tone: "danger", msg: err instanceof Error ? err.message : String(err) });
      }
      collector.current.reset();
      setProgress({ have: 0, total: 0 });
    }
  };

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  useEffect(() => {
    if (!scanning) return;
    if (video.current && streamRef.current) {
      video.current.srcObject = streamRef.current;
      void video.current.play().catch(() => {});
    }
    let raf = 0;
    let last = 0;
    let lastData = "";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const v = video.current;
      if (!v || !ctx || v.readyState < 2 || t - last < 200) return;
      last = t;
      const scale = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      if (code?.data && code.data !== lastData) {
        lastData = code.data;
        void feed(code.data);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feed reads refs only
  }, [scanning]);

  const startCamera = async () => {
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      setScanning(true);
    } catch (err) {
      setStatus(`Camera unavailable: ${err instanceof Error ? err.message : String(err)}. Use photos or paste the text instead.`);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {scanning ? (
          <Btn icon={X} onClick={stop}>
            Stop camera
          </Btn>
        ) : (
          <Btn icon={Camera} variant="soft" onClick={() => void startCamera()}>
            Scan with camera
          </Btn>
        )}
        <label className="mono inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-white/10 bg-white/[0.06] px-3 text-[11px] hover:bg-white/[0.1]">
          <ImageUp size={12} /> From photos
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={async (e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = "";
              for (const f of picked) {
                const data = await decodeImageFile(f).catch(() => null);
                if (data) await feed(data);
                else setStatus(`No QR code found in ${f.name}`);
              }
            }}
          />
        </label>
      </div>
      {scanning && <video ref={video} playsInline muted className="max-h-[240px] w-full rounded-[10px] bg-black object-contain" />}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="…or paste the text lines (SF1:… or F|…)"
        className="mono h-[60px] w-full resize-none rounded-[8px] border border-white/10 bg-black p-2 text-[10px] outline-none"
        aria-label="Backup fragments as text"
      />
      <Btn
        disabled={!text.trim()}
        onClick={async () => {
          setResult(null);
          for (const line of text.split("\n")) if (line.trim()) await feed(line);
          setText("");
        }}
      >
        Restore from text
      </Btn>
      {progress.total > 0 && (
        <Notice tone="muted">
          {progress.have} of {progress.total} codes collected. Missing: {collector.current.missing().join(", ")}
        </Notice>
      )}
      {status && !result && <div className="mono text-[10px] text-white/55">{status}</div>}
      {result && <Notice tone={result.tone}>{result.msg}</Notice>}
    </div>
  );
}
