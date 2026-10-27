import { batch, getAll, type Pod } from "./db";
import { notifyChange } from "./fs";

export type { Pod } from "./db";

export async function listPods(): Promise<Pod[]> {
  const pods = await getAll<Pod>("pods");
  return pods.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function putPods(pods: Pod[]): Promise<void> {
  await batch("pods", pods);
  notifyChange();
}

export async function deletePod(id: string): Promise<void> {
  await batch("pods", [], [id]);
  notifyChange();
}

export function isPod(value: unknown): value is Pod {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const full = v.fullText as Record<string, unknown> | undefined;
  return (
    typeof v.id === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.summary === "string" &&
    typeof v.model === "string" &&
    typeof v.endpoint === "string" &&
    !!full &&
    typeof full.user === "string" &&
    typeof full.assistant === "string"
  );
}
