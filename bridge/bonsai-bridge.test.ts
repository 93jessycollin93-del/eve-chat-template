import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBridge } from "./bonsai-bridge.mjs";

let ollama: http.Server;
let bridge: http.Server;
let base = "";
const seen: { origin?: string; path?: string; body?: string }[] = [];

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

beforeAll(async () => {
  // A fake Ollama that streams two NDJSON chunks.
  ollama = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ origin: req.headers.origin, path: req.url, body });
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "bonsai:latest" }] }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write('{"message":{"content":"Hi"}}\n');
      setTimeout(() => res.end('{"done":true,"eval_count":3}\n'), 10);
    });
  });
  const ollamaPort = await listen(ollama);
  bridge = createBridge({ key: "correct-horse-battery", upstream: `http://127.0.0.1:${ollamaPort}`, origins: ["https://foundry.example"] });
  base = `http://127.0.0.1:${await listen(bridge)}`;
});

afterAll(() => {
  bridge.close();
  ollama.close();
});

describe("bonsai bridge", () => {
  it("answers CORS and private-network preflights", async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: "OPTIONS",
      headers: { Origin: "https://foundry.example", "Access-Control-Request-Private-Network": "true" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://foundry.example");
    expect(res.headers.get("access-control-allow-headers")).toContain("X-Bonsai-Key");
    expect(res.headers.get("access-control-allow-private-network")).toBe("true");
  });

  it("rejects a missing or wrong key", async () => {
    expect((await fetch(`${base}/api/tags`)).status).toBe(401);
    expect((await fetch(`${base}/api/tags`, { headers: { "X-Bonsai-Key": "nope" } })).status).toBe(401);
  });

  it("rejects origins that are not allowed", async () => {
    const res = await fetch(`${base}/api/tags`, { headers: { Origin: "https://evil.example", "X-Bonsai-Key": "correct-horse-battery" } });
    expect(res.status).toBe(403);
  });

  it("only exposes the chat endpoints", async () => {
    const res = await fetch(`${base}/api/delete`, { method: "POST", headers: { "X-Bonsai-Key": "correct-horse-battery" } });
    expect(res.status).toBe(404);
  });

  it("streams responses through and strips the browser origin", async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { Origin: "https://foundry.example", "X-Bonsai-Key": "correct-horse-battery", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "bonsai", messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://foundry.example");
    expect(await res.text()).toBe('{"message":{"content":"Hi"}}\n{"done":true,"eval_count":3}\n');
    const last = seen.at(-1)!;
    expect(last.path).toBe("/api/chat");
    expect(last.origin).toBeUndefined();
    expect(JSON.parse(last.body!).model).toBe("bonsai");
  });

  it("reports when Ollama is down", async () => {
    const down = createBridge({ key: "k", upstream: "http://127.0.0.1:9" });
    const port = await listen(down);
    const res = await fetch(`http://127.0.0.1:${port}/api/tags`, { headers: { "X-Bonsai-Key": "k" } });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/not reachable/);
    down.close();
  });
});
