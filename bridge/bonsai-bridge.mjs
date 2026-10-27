#!/usr/bin/env node
/**
 * Bonsai bridge: a tiny proxy between Sovereign Foundry (in your browser or on
 * your phone) and Ollama on this computer.
 *
 *  - Requires a shared secret in the X-Bonsai-Key header.
 *  - Answers browser CORS / Private Network Access checks, so you do not need
 *    to reconfigure Ollama's OLLAMA_ORIGINS.
 *  - Only forwards the few Ollama endpoints the app uses (no model deletion,
 *    no pulls) and streams responses through untouched.
 *
 * Usage:
 *   BONSAI_KEY=pick-a-long-secret node bridge/bonsai-bridge.mjs
 *
 * Environment:
 *   BONSAI_KEY       required shared secret (or pass --no-key for localhost-only use)
 *   BONSAI_PORT      default 11435
 *   BONSAI_HOST      default 127.0.0.1 (use 0.0.0.0 to accept other devices on your LAN)
 *   OLLAMA_URL       default http://127.0.0.1:11434
 *   BONSAI_ORIGINS   comma-separated allowed site origins, default * (the key still applies)
 *
 * No dependencies; needs Node 18+.
 */
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { pathToFileURL } from "node:url";

export const ALLOWED_PATHS = new Set(["/api/chat", "/api/generate", "/api/tags", "/api/version", "/api/show", "/api/ps"]);

/**
 * Constant-time comparison so the key cannot be guessed byte by byte.
 * @param {string | string[] | undefined} given
 * @param {string} expected
 */
function keyMatches(given, expected) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ key?: string, upstream?: string, origins?: string[] }} options
 * @returns {http.Server}
 */
export function createBridge({ key = "", upstream = "http://127.0.0.1:11434", origins = ["*"] } = {}) {
  const target = new URL(upstream);
  const client = target.protocol === "https:" ? https : http;

  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    const anyOrigin = origins.includes("*");
    if (origin && !anyOrigin && !origins.includes(origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Origin ${origin} is not allowed by BONSAI_ORIGINS` }));
      return;
    }

    /** @type {Record<string, string>} */
    const cors = {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Bonsai-Key",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
    if (req.headers["access-control-request-private-network"]) cors["Access-Control-Allow-Private-Network"] = "true";

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://bridge.local");
    const json = { ...cors, "Content-Type": "application/json" };
    if (!ALLOWED_PATHS.has(url.pathname)) {
      res.writeHead(404, json);
      res.end(JSON.stringify({ error: `${url.pathname} is not exposed by the Bonsai bridge` }));
      return;
    }
    if (key && !keyMatches(req.headers["x-bonsai-key"], key)) {
      res.writeHead(401, json);
      res.end(JSON.stringify({ error: "Missing or wrong X-Bonsai-Key" }));
      return;
    }

    // Do not forward the browser's Origin: Ollama would apply its own CORS rules to it.
    const upstreamReq = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: url.pathname + url.search,
        method: req.method,
        headers: { "Content-Type": req.headers["content-type"] || "application/json" },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, {
          ...cors,
          "Content-Type": up.headers["content-type"] || "application/json",
          "Cache-Control": "no-cache",
        });
        up.pipe(res);
      },
    );
    upstreamReq.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, json);
      res.end(JSON.stringify({ error: `Ollama is not reachable at ${upstream}: ${err.message}` }));
    });
    // If the browser stops the stream, stop asking Ollama for more tokens.
    res.on("close", () => {
      if (!res.writableFinished) upstreamReq.destroy();
    });
    req.pipe(upstreamReq);
  });
}

/** @param {string} host */
function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.env.BONSAI_KEY ?? "";
  const noKey = process.argv.includes("--no-key");
  const host = process.env.BONSAI_HOST || "127.0.0.1";
  const port = Number(process.env.BONSAI_PORT || 11435);
  const upstream = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const origins = (process.env.BONSAI_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);

  if (!key && !noKey) {
    console.error("Set BONSAI_KEY to a long secret, e.g.\n  BONSAI_KEY=$(openssl rand -hex 16) npm run bridge\n(or pass --no-key to allow keyless access from this computer only)");
    process.exit(1);
  }
  if (!key && !isLoopback(host)) {
    console.error("Refusing to listen on a network address without BONSAI_KEY.");
    process.exit(1);
  }
  if (key && key.length < 12) console.warn("Warning: BONSAI_KEY is short. Use at least 16 random characters.");

  createBridge({ key, upstream, origins }).listen(port, host, () => {
    console.log(`Bonsai bridge listening on http://${host}:${port} → ${upstream}`);
    console.log(key ? "Key required (X-Bonsai-Key)." : "No key: only this computer can connect.");
    console.log(`Allowed origins: ${origins.join(", ")}`);
    console.log("Phone access: cloudflared tunnel --url http://localhost:" + port);
  });
}
