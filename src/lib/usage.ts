/** Daily Bonsai usage counters, kept in localStorage (same key as the original artifact). */

export interface Usage {
  date: string;
  count: number;
  tokens: number;
  totalLatency: number;
  avgLatency: number;
}

const KEY = "bonsai_usage";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function empty(): Usage {
  return { date: today(), count: 0, tokens: 0, totalLatency: 0, avgLatency: 0 };
}

export function readUsage(): Usage {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const u = JSON.parse(raw) as Usage;
    return u.date === today() ? u : empty();
  } catch {
    return empty();
  }
}

export function recordUsage(tokens: number, latencyMs: number): Usage {
  const u = readUsage();
  u.count += 1;
  u.tokens += tokens;
  u.totalLatency += latencyMs;
  u.avgLatency = Math.round(u.totalLatency / u.count);
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    /* storage full or blocked: counters are best-effort */
  }
  return u;
}
