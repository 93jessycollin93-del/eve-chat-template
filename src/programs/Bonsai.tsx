import { ChevronDown, ChevronRight, Eye, EyeOff, KeyRound, Leaf, RotateCcw, Send, Square, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { randomId } from "../lib/bytes";
import { checkReachability, mixedContentProblem, normalizeEndpoint, streamChat, type ChatMessage, type Reachability } from "../lib/ollama";
import { listPods, putPods, type Pod } from "../lib/pods";
import { recordUsage } from "../lib/usage";
import { useLocalSetting } from "../os/hooks";
import { useOs } from "../os/OsContext";
import type { ProgramProps } from "../os/programs";
import { QrCanvas } from "../ui/qr";
import { Btn, inputClass, Notice, SourceChip } from "../ui/ui";

interface Turn {
  role: "user" | "assistant";
  content: string;
  model?: string;
}

const MEMORY_PODS = 5;

function memoryBlock(pods: Pod[]): string {
  if (!pods.length) return "";
  const lines = pods.slice(0, MEMORY_PODS).map((p) => {
    const u = p.fullText.user.replace(/\s+/g, " ").slice(0, 220);
    const a = p.fullText.assistant.replace(/\s+/g, " ").slice(0, 280);
    return `- ${p.timestamp.slice(0, 10)} — they said: “${u}” — you answered: “${a}”`;
  });
  return `\n\nMemory pods from earlier conversations (most recent first). Use them only when relevant:\n${lines.join("\n")}`;
}

function SetupHelp() {
  return (
    <div className="mono space-y-1.5 text-[10px] leading-5 text-white/65">
      <div>
        1. Install <span className="text-white">Ollama</span> on your computer (ollama.com).
      </div>
      <div>
        2. Create Bonsai: <code className="rounded bg-white/10 px-1">ollama create bonsai -f bridge/Modelfile</code> (or just <code className="rounded bg-white/10 px-1">ollama pull llama3.2:3b</code>).
      </div>
      <div>
        3. Start the bridge from this repo: <code className="rounded bg-white/10 px-1">BONSAI_KEY=pick-a-secret npm run bridge</code>. It listens on :11435, checks the key, and allows this site.
      </div>
      <div>
        4. Same computer: use <code className="rounded bg-white/10 px-1">http://localhost:11435</code>. Phone: run <code className="rounded bg-white/10 px-1">cloudflared tunnel --url http://localhost:11435</code> and paste its https URL here.
      </div>
    </div>
  );
}

export default function Bonsai(_: ProgramProps) {
  const { hostName, open } = useOs();
  const [endpoint, setEndpoint] = useLocalSetting("bonsai_endpoint", "http://localhost:11434");
  const [model, setModel] = useLocalSetting("bonsai_model", "bonsai");
  const [key, setKey] = useLocalSetting("bonsai_secret", "");
  const [memory, setMemory] = useLocalSetting("bonsai_memory", "on");
  const [showKey, setShowKey] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [link, setLink] = useState<Reachability | null>(null);
  const [testing, setTesting] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [podNote, setPodNote] = useState("");
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastPrompt = useRef("");

  const mixed = typeof location !== "undefined" ? mixedContentProblem(endpoint, location.protocol) : null;

  const test = async () => {
    setTesting(true);
    const r = await checkReachability(endpoint, key);
    setLink(r);
    setTesting(false);
    if (r.ok) {
      setShowSettings(false);
      if (r.models.length && !r.models.some((m) => m === model || m.startsWith(`${model}:`))) setModel(r.models[0].replace(/:latest$/, ""));
    }
  };

  useEffect(() => {
    void test();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- test once when the window opens
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo(0, scroller.current.scrollHeight);
  }, [turns]);

  useEffect(() => () => abort.current?.abort(), []);

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || streaming) return;
    lastPrompt.current = prompt;
    setError("");
    setInput("");
    const history = [...turns, { role: "user" as const, content: prompt }];
    setTurns([...history, { role: "assistant", content: "", model }]);
    setStreaming(true);
    const ctrl = new AbortController();
    abort.current = ctrl;

    const pods = memory === "on" ? await listPods() : [];
    const system: ChatMessage = {
      role: "system",
      content: `You are Bonsai, the small personal AI that lives on ${hostName}'s own computer, inside Sovereign Foundry. Be helpful, honest and concise. If you do not know something, say so.${memoryBlock(pods)}`,
    };

    try {
      const result = await streamChat({
        endpoint,
        key,
        model,
        messages: [system, ...history.map((t) => ({ role: t.role, content: t.content }))],
        signal: ctrl.signal,
        onToken: (full) =>
          setTurns((ts) => {
            const next = [...ts];
            next[next.length - 1] = { ...next[next.length - 1], content: full };
            return next;
          }),
      });
      const tokens = result.evalCount ?? Math.ceil((prompt.length + result.text.length) / 4);
      recordUsage(tokens, result.latencyMs);
      if (result.text) {
        const pod: Pod = {
          id: `${Date.now()}-${randomId(2)}`,
          timestamp: new Date().toISOString(),
          summary: prompt.slice(0, 80) + (prompt.length > 80 ? "…" : ""),
          fullText: { user: prompt, assistant: result.text },
          model,
          endpoint: normalizeEndpoint(endpoint),
        };
        await putPods([pod]);
        setPodNote(`Saved as a memory pod · ${tokens} tokens · ${(result.latencyMs / 1000).toFixed(1)}s`);
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) setError(err instanceof Error ? err.message : String(err));
      setTurns((ts) => (ts.at(-1)?.role === "assistant" && !ts.at(-1)?.content ? ts.slice(0, -1) : ts));
    } finally {
      setStreaming(false);
      abort.current = null;
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0a120f]">
      <div className="space-y-2 border-b border-white/10 bg-white/[0.02] p-2.5">
        <div className="mono flex items-center justify-between gap-2 text-[11px]">
          <button className="flex min-w-0 items-center gap-2" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
            {showSettings ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Leaf size={12} color="#7cff9a" />
            <span className="truncate">Bonsai · {model}</span>
          </button>
          <SourceChip tone={link?.ok ? "accent" : link ? "danger" : "muted"}>{link?.ok ? "connected" : link ? "offline" : testing ? "checking…" : "not checked"}</SourceChip>
        </div>

        {showSettings && (
          <div className="mono space-y-2 rounded-[10px] border border-white/10 bg-black/60 p-2.5">
            <label className="block text-[9px] text-white/55" htmlFor="bonsai-endpoint">
              ENDPOINT — Ollama (:11434) or the Bonsai bridge (:11435)
            </label>
            <div className="flex gap-1.5">
              <input id="bonsai-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className={`${inputClass} min-w-0 flex-1 text-[11px]`} placeholder="http://localhost:11435" />
              <Btn icon={Wifi} disabled={testing} onClick={() => void test()}>
                {testing ? "Testing…" : "Test"}
              </Btn>
            </div>
            {mixed && <Notice tone="warn">{mixed}</Notice>}
            {link && <Notice tone={link.ok ? "accent" : "danger"}>{link.message}</Notice>}

            <label className="block text-[9px] text-white/55" htmlFor="bonsai-model">
              MODEL
            </label>
            {link?.ok && link.models.length > 0 ? (
              <select id="bonsai-model" value={link.models.find((m) => m === model || m === `${model}:latest`) ?? model} onChange={(e) => setModel(e.target.value.replace(/:latest$/, ""))} className={`${inputClass} w-full text-[11px]`}>
                {!link.models.some((m) => m === model || m === `${model}:latest`) && <option value={model}>{model} (not installed)</option>}
                {link.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input id="bonsai-model" value={model} onChange={(e) => setModel(e.target.value)} className={`${inputClass} w-full text-[11px]`} placeholder="bonsai" />
            )}

            <label className="flex items-center gap-1 text-[9px] text-white/55" htmlFor="bonsai-key">
              <KeyRound size={10} /> BRIDGE KEY (sent as X-Bonsai-Key; enforced by the bridge)
            </label>
            <div className="flex gap-1.5">
              <input
                id="bonsai-key"
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className={`${inputClass} min-w-0 flex-1 text-[11px]`}
                placeholder="optional — required if the bridge has BONSAI_KEY"
                autoComplete="off"
              />
              <Btn icon={showKey ? EyeOff : Eye} aria-label={showKey ? "Hide key" : "Show key"} onClick={() => setShowKey((s) => !s)}>
                <span className="sr-only">toggle</span>
              </Btn>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-white/75">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={memory === "on"} onChange={(e) => setMemory(e.target.checked ? "on" : "off")} className="accent-[#00FF88]" />
                Memory: share my last {MEMORY_PODS} pods with Bonsai
              </label>
              <button className="text-[9px] text-cyan underline" onClick={() => open("memory")}>
                view pods
              </button>
            </div>

            <div className="flex flex-wrap gap-3 text-[10px]">
              <button className="text-white/60 underline" onClick={() => setShowHelp((s) => !s)}>
                {showHelp ? "Hide setup steps" : "How to set up Bonsai"}
              </button>
              <button className="text-white/60 underline" onClick={() => setShowQr((s) => !s)}>
                {showQr ? "Hide QR" : "Endpoint as QR"}
              </button>
            </div>
            {showHelp && <SetupHelp />}
            {showQr && (
              <div className="flex items-center gap-3">
                <QrCanvas text={normalizeEndpoint(endpoint) || " "} size={110} />
                <span className="text-[9px] break-all text-white/50">{normalizeEndpoint(endpoint)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-auto p-3" role="log" aria-live="polite">
        {turns.length === 0 && (
          <div className="mono rounded-[10px] border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-5 text-white/55">
            Bonsai is small, fast and local: it runs on your own hardware through Ollama, and nothing goes to a cloud AI. If Bonsai cannot be reached you will see the real error, never a made-up
            answer.
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`mono rounded-[12px] border p-3 ${t.role === "user" ? "ml-6 border-white/10 bg-white/[0.04] sm:ml-10" : "mr-6 border-[#7cff9a]/20 bg-[#7cff9a]/[0.06] sm:mr-10"}`}>
            <div className="mb-1 text-[9px] text-white/50">{t.role === "user" ? hostName.toUpperCase() : `BONSAI · ${t.model ?? model}`}</div>
            <div className="text-[12px] leading-6 whitespace-pre-wrap select-text">{t.content || (streaming && i === turns.length - 1 ? "▌" : "")}</div>
          </div>
        ))}
        {error && (
          <div className="space-y-2">
            <Notice tone="danger">{error}</Notice>
            <Btn icon={RotateCcw} variant="danger" onClick={() => void send(lastPrompt.current)}>
              Retry
            </Btn>
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-white/10 bg-black/40 p-2.5">
        {podNote && !streaming && <div className="mono text-[9px] text-accent">{podNote}</div>}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Talk to Bonsai…"
            className={`${inputClass} h-10 min-w-0 flex-1`}
            aria-label="Message Bonsai"
            enterKeyHint="send"
          />
          {streaming ? (
            <button type="button" onClick={() => abort.current?.abort()} className="mono flex h-10 items-center gap-1.5 rounded-[10px] bg-white/15 px-4 text-[11px]">
              <Square size={12} /> Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="mono flex h-10 items-center gap-1.5 rounded-[10px] bg-[#7cff9a] px-4 text-[11px] font-semibold text-black disabled:opacity-40">
              <Send size={12} /> Send
            </button>
          )}
        </form>
        <div className="mono flex justify-between text-[8px] text-white/40">
          <button className="underline" disabled={streaming} onClick={() => setTurns([])}>
            New chat
          </button>
          <span>streams from {normalizeEndpoint(endpoint)}/api/chat</span>
        </div>
      </div>
    </div>
  );
}
