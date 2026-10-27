/**
 * Minimal Ollama client: streams /api/chat, lists models from /api/tags, and
 * explains connection failures in plain language.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  evalCount?: number;
  latencyMs: number;
}

export interface Reachability {
  ok: boolean;
  models: string[];
  message: string;
  status?: number;
}

export function normalizeEndpoint(endpoint: string): string {
  let e = endpoint.trim().replace(/\/+$/, "");
  if (e && !/^https?:\/\//i.test(e)) e = `http://${e}`;
  return e;
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

/** Browsers block http:// requests from an https:// page, except to localhost. */
export function mixedContentProblem(endpoint: string, pageProtocol: string): string | null {
  try {
    const url = new URL(normalizeEndpoint(endpoint));
    if (pageProtocol === "https:" && url.protocol === "http:" && !isLoopback(url.hostname)) {
      return "This page is served over https, so the browser will block a plain http:// endpoint on another device. Use an https tunnel (e.g. cloudflared) in front of the Bonsai bridge.";
    }
  } catch {
    return "That endpoint is not a valid URL.";
  }
  return null;
}

function headers(key: string, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (key) h["X-Bonsai-Key"] = key;
  return h;
}

export function explainNetworkError(err: unknown, endpoint: string): string {
  if (err instanceof DOMException && err.name === "AbortError") return "Timed out waiting for Ollama.";
  const base = err instanceof Error ? err.message : String(err);
  const problem = typeof location !== "undefined" ? mixedContentProblem(endpoint, location.protocol) : null;
  if (problem) return problem;
  return `Could not reach ${endpoint} (${base}). Check that Ollama or the Bonsai bridge is running, and that it allows this site: run the bridge (npm run bridge) or start Ollama with OLLAMA_ORIGINS set to this page's origin.`;
}

export async function checkReachability(endpoint: string, key: string, timeoutMs = 4000): Promise<Reachability> {
  const base = normalizeEndpoint(endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/tags`, { headers: headers(key), signal: ctrl.signal });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, models: [], status: res.status, message: `The bridge rejected the key (${res.status}).` };
    }
    if (!res.ok) return { ok: false, models: [], status: res.status, message: `Ollama answered HTTP ${res.status}.` };
    const data = (await res.json().catch(() => ({}))) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name).sort();
    return { ok: true, models, message: `Connected — ${models.length} model${models.length === 1 ? "" : "s"} installed.` };
  } catch (err) {
    return { ok: false, models: [], message: explainNetworkError(err, base) };
  } finally {
    clearTimeout(timer);
  }
}

/** Splits an NDJSON buffer into complete lines plus the unfinished remainder. */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

interface OllamaChunk {
  message?: { content?: string };
  response?: string;
  eval_count?: number;
  error?: string;
  done?: boolean;
}

export async function streamChat(opts: {
  endpoint: string;
  key: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onToken: (fullText: string) => void;
}): Promise<ChatResult> {
  const base = normalizeEndpoint(opts.endpoint);
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: headers(opts.key, true),
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error(explainNetworkError(err, base), { cause: err });
  }
  if (res.status === 401 || res.status === 403) throw new Error("The Bonsai bridge rejected the key.");
  if (res.status === 404) {
    const body = await res.text().catch(() => "");
    throw new Error(
      body.includes("not found") ? `Model "${opts.model}" is not installed. Run: ollama pull ${opts.model}` : `HTTP 404 from ${base}/api/chat`,
    );
  }
  if (!res.ok) throw new Error(`Ollama answered HTTP ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("The response has no body; streaming is not supported here.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let evalCount: number | undefined;
  const handle = (line: string) => {
    let chunk: OllamaChunk;
    try {
      chunk = JSON.parse(line) as OllamaChunk;
    } catch {
      return;
    }
    if (chunk.error) throw new Error(chunk.error);
    const piece = chunk.message?.content ?? chunk.response ?? "";
    if (chunk.eval_count) evalCount = chunk.eval_count;
    if (piece) {
      text += piece;
      opts.onToken(text);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { lines, rest } = splitNdjson(buffer);
    buffer = rest;
    lines.forEach(handle);
  }
  if (buffer.trim()) handle(buffer.trim());
  return { text, evalCount, latencyMs: Math.round(performance.now() - started) };
}
