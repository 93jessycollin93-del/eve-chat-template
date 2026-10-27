import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocalSetting } from "./hooks";
import { PROGRAMS, type ProgramId } from "./programs";

export interface WindowState {
  id: string;
  programId: ProgramId;
  args?: Record<string, string>;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
  z: number;
  openedAt: number;
}

export interface OsApi {
  windows: WindowState[];
  activeId: string | null;
  open: (programId: ProgramId, args?: Record<string, string>) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  setGeometry: (id: string, patch: Partial<Pick<WindowState, "x" | "y" | "w" | "h">>) => void;
  hostName: string;
  setHostName: (name: string) => void;
  launcherOpen: boolean;
  setLauncherOpen: (open: boolean) => void;
}

interface WmState {
  windows: WindowState[];
  activeId: string | null;
  topZ: number;
}

const OsContext = createContext<OsApi | null>(null);

export function useOs(): OsApi {
  const ctx = useContext(OsContext);
  if (!ctx) throw new Error("useOs must be used inside <OsProvider>");
  return ctx;
}

function newWindow(programId: ProgramId, args: Record<string, string> | undefined, count: number, z: number): WindowState {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const n = count % 8;
  const w = Math.max(320, Math.min(660, vw - 140));
  const h = Math.max(260, Math.min(500, vh - 140));
  return {
    id: `${programId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    programId,
    args,
    // Start right of the two desktop icon columns.
    x: Math.max(8, Math.min(200 + n * 28, vw - w - 8)),
    y: Math.max(8, Math.min(20 + n * 24, vh - h - 70)),
    w,
    h,
    minimized: false,
    maximized: false,
    z,
    openedAt: Date.now(),
  };
}

export function OsProvider({ children }: { children: ReactNode }) {
  const [wm, setWm] = useState<WmState>({ windows: [], activeId: null, topZ: 10 });
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [hostName, setHostName] = useLocalSetting("sf_host", "Jessy");

  const focus = useCallback((id: string) => {
    setWm((s) => {
      const z = s.topZ + 1;
      return { windows: s.windows.map((w) => (w.id === id ? { ...w, z, minimized: false } : w)), activeId: id, topZ: z };
    });
  }, []);

  const open = useCallback((programId: ProgramId, args?: Record<string, string>) => {
    setWm((s) => {
      const z = s.topZ + 1;
      const existing = s.windows.find((w) => w.programId === programId);
      if (existing) {
        return {
          windows: s.windows.map((w) => (w.id === existing.id ? { ...w, z, minimized: false, args: args ?? w.args } : w)),
          activeId: existing.id,
          topZ: z,
        };
      }
      const win = newWindow(programId, args, s.windows.length, z);
      return { windows: [...s.windows, win], activeId: win.id, topZ: z };
    });
  }, []);

  const close = useCallback((id: string) => {
    setWm((s) => ({ ...s, windows: s.windows.filter((w) => w.id !== id), activeId: s.activeId === id ? null : s.activeId }));
  }, []);

  const minimize = useCallback((id: string) => {
    setWm((s) => ({
      ...s,
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setWm((s) => ({ ...s, windows: s.windows.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w)) }));
  }, []);

  const setGeometry = useCallback((id: string, patch: Partial<Pick<WindowState, "x" | "y" | "w" | "h">>) => {
    setWm((s) => ({ ...s, windows: s.windows.map((w) => (w.id === id ? { ...w, ...patch, maximized: false } : w)) }));
  }, []);

  const activeProgram = wm.windows.find((w) => w.id === wm.activeId)?.programId;
  useEffect(() => {
    document.title = activeProgram ? `${PROGRAMS[activeProgram].short} · Sovereign Foundry` : "Sovereign Foundry";
  }, [activeProgram]);

  const api = useMemo<OsApi>(
    () => ({
      windows: wm.windows,
      activeId: wm.activeId,
      open,
      close,
      focus,
      minimize,
      toggleMaximize,
      setGeometry,
      hostName,
      setHostName,
      launcherOpen,
      setLauncherOpen,
    }),
    [wm, open, close, focus, minimize, toggleMaximize, setGeometry, hostName, setHostName, launcherOpen],
  );

  return <OsContext.Provider value={api}>{children}</OsContext.Provider>;
}
