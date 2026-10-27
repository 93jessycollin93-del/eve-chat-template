import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FileRecord, Pod } from "../lib/db";
import { fsEvents, listFiles } from "../lib/fs";
import { listPods } from "../lib/pods";
import { getVaultSession, subscribeVault } from "../lib/vault-session";

function useFsData<T>(load: () => Promise<T>, initial: T): { data: T; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // `load` must be a stable function (module-level), so it is safe as a dependency.
  const reload = useCallback(() => {
    const id = ++seq.current;
    load()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => id === seq.current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => id === seq.current && setLoading(false));
  }, [load]);

  useEffect(() => {
    reload();
    fsEvents.addEventListener("change", reload);
    return () => fsEvents.removeEventListener("change", reload);
  }, [reload]);

  return { data, loading, error, reload };
}

/** All files, kept in sync with every write (in this tab and others). */
export function useFiles() {
  const r = useFsData<FileRecord[]>(listFiles, []);
  return { files: r.data, loading: r.loading, error: r.error, reload: r.reload };
}

export function usePods() {
  const r = useFsData<Pod[]>(listPods, []);
  return { pods: r.data, loading: r.loading, error: r.error, reload: r.reload };
}

export function useVaultSession() {
  return useSyncExternalStore(subscribeVault, getVaultSession);
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useInterval(() => setNow(new Date()), ms);
  return now;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
  );
}

/** A flash message that clears itself. */
export function useToast(ms = 4000): [string, (msg: string) => void] {
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (m: string) => {
      setMsg(m);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(""), ms);
    },
    [ms],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [msg, show];
}

export function useLocalSetting(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const update = useCallback(
    (v: string) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, update];
}
