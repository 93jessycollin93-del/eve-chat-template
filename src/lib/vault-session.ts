/** Holds the vault key in memory only, and forgets it after a period of inactivity. */

export const AUTO_LOCK_MS = 5 * 60 * 1000;

interface VaultSession {
  key: CryptoKey | null;
  lastActivity: number;
}

let state: VaultSession = { key: null, lastActivity: 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = state.key ? setTimeout(lockVault, AUTO_LOCK_MS) : null;
}

export function getVaultSession(): VaultSession {
  return state;
}

export function subscribeVault(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setVaultKey(key: CryptoKey): void {
  state = { key, lastActivity: Date.now() };
  schedule();
  emit();
}

/** Call on any vault interaction to push back the auto-lock. */
export function touchVault(): void {
  if (!state.key) return;
  state = { ...state, lastActivity: Date.now() };
  schedule();
  emit();
}

export function lockVault(): void {
  state = { key: null, lastActivity: 0 };
  schedule();
  emit();
}
