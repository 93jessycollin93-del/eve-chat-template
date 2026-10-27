import { useSyncExternalStore } from "react";

/**
 * Service worker + install state. The service worker caches the app so it
 * opens offline; updates wait for the user to accept them.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PwaState {
  supported: boolean;
  registered: boolean;
  offlineReady: boolean;
  needRefresh: boolean;
  error: string | null;
  canInstall: boolean;
  installed: boolean;
  lastCheck: string | null;
}

let state: PwaState = {
  supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
  registered: false,
  offlineReady: false,
  needRefresh: false,
  error: null,
  canInstall: false,
  installed:
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true),
  lastCheck: null,
};

const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let installEvent: BeforeInstallPromptEvent | null = null;
let started = false;

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export async function startPwa(): Promise<void> {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => set({ installed: true, canInstall: false }));

  if (!state.supported) return;
  try {
    const { registerSW } = await import("virtual:pwa-register");
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => set({ needRefresh: true }),
      onOfflineReady: () => set({ offlineReady: true }),
      onRegisteredSW: (_url, reg) => {
        registration = reg;
        set({ registered: !!reg, offlineReady: state.offlineReady || !!reg?.active });
      },
      onRegisterError: (err: unknown) => set({ error: err instanceof Error ? err.message : String(err) }),
    });
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
  }
}

export async function applyUpdate(): Promise<void> {
  await updateSW?.(true);
}

export async function checkForUpdate(): Promise<string> {
  if (!registration) return state.supported ? "Service worker is not registered yet (it only runs on built, deployed copies)." : "This browser has no service worker support.";
  await registration.update();
  set({ lastCheck: new Date().toISOString() });
  return state.needRefresh ? "An update is ready." : "You are on the latest version.";
}

export async function promptInstall(): Promise<string> {
  if (!installEvent) return "Install is not offered by this browser.";
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  set({ canInstall: false });
  return outcome === "accepted" ? "Installed." : "Install dismissed.";
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
