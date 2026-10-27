import { afterEach, describe, expect, it, vi } from "vitest";
import { mixedContentProblem, normalizeEndpoint, splitNdjson, streamChat } from "./ollama";

afterEach(() => vi.unstubAllGlobals());

describe("ollama client", () => {
  it("normalizes endpoints", () => {
    expect(normalizeEndpoint(" 192.168.1.5:11434/ ")).toBe("http://192.168.1.5:11434");
    expect(normalizeEndpoint("https://x.trycloudflare.com")).toBe("https://x.trycloudflare.com");
  });

  it("warns about mixed content only where browsers block it", () => {
    expect(mixedContentProblem("http://192.168.1.5:11434", "https:")).toMatch(/https tunnel/);
    expect(mixedContentProblem("http://localhost:11434", "https:")).toBeNull();
    expect(mixedContentProblem("https://x.example", "https:")).toBeNull();
    expect(mixedContentProblem("http://192.168.1.5:11434", "http:")).toBeNull();
  });

  it("splits NDJSON while keeping partial lines", () => {
    expect(splitNdjson('{"a":1}\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
  });

  it("streams tokens and sends the key header", async () => {
    const body = ['{"message":{"content":"Hel"}}\n{"message":{"con', 'tent":"lo"}}\n', '{"done":true,"eval_count":7}'];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["X-Bonsai-Key"]).toBe("k");
      const stream = new ReadableStream({
        start(c) {
          body.forEach((b) => c.enqueue(new TextEncoder().encode(b)));
          c.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const tokens: string[] = [];
    const result = await streamChat({ endpoint: "http://h:1", key: "k", model: "bonsai", messages: [], onToken: (t) => tokens.push(t) });
    expect(result.text).toBe("Hello");
    expect(result.evalCount).toBe(7);
    expect(tokens).toEqual(["Hel", "Hello"]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://h:1/api/chat");
  });

  it("explains a missing model", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":"model \\"bonsai\\" not found"}', { status: 404 }));
    await expect(streamChat({ endpoint: "http://h:1", key: "", model: "bonsai", messages: [], onToken: () => {} })).rejects.toThrow(
      /ollama pull bonsai/,
    );
  });
});
