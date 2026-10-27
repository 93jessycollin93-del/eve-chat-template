import { Maximize2, Minus, Square, X } from "lucide-react";
import { Component, Suspense, useRef, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Btn, Spinner } from "../ui/ui";
import { useOs, type WindowState } from "./OsContext";
import { PROGRAMS } from "./programs";

class ProgramErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null; key: number }> {
  state = { error: null as Error | null, key: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} crashed`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mono flex h-full flex-col items-start gap-3 p-4 text-[11px]">
          <div className="font-semibold text-red-300">{this.props.name} stopped working.</div>
          <div className="whitespace-pre-wrap text-white/60">{this.state.error.message}</div>
          <div className="text-white/40">Your files are safe; this only affects this window.</div>
          <Btn variant="soft" onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>
            Restart program
          </Btn>
        </div>
      );
    }
    return <div key={this.state.key} className="h-full">{this.props.children}</div>;
  }
}

export function Window({ win, compact, active }: { win: WindowState; compact: boolean; active: boolean }) {
  const { focus, close, minimize, toggleMaximize, setGeometry } = useOs();
  const program = PROGRAMS[win.programId];
  const Program = program.component;
  const Icon = program.icon;
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);
  const full = compact || win.maximized;

  const start = (mode: "move" | "resize") => (e: ReactPointerEvent<HTMLElement>) => {
    if (full || e.button !== 0) return;
    if (mode === "move" && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    focus(win.id);
  };

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === "move") {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setGeometry(win.id, {
        x: Math.min(Math.max(d.x + dx, 80 - d.w), vw - 80),
        y: Math.min(Math.max(d.y + dy, 0), vh - 100),
      });
    } else {
      setGeometry(win.id, { w: Math.max(320, d.w + dx), h: Math.max(220, d.h + dy) });
    }
  };

  const end = () => {
    drag.current = null;
  };

  return (
    <section
      role="dialog"
      aria-label={program.title}
      className={`absolute flex flex-col overflow-hidden border backdrop-blur-[22px] ${
        full ? "rounded-none sm:rounded-[14px]" : "rounded-[14px]"
      } ${active ? "border-white/[0.16]" : "border-white/[0.08]"} shadow-[0_24px_80px_rgba(0,0,0,0.6)]`}
      style={{
        left: full ? (compact ? 0 : 8) : win.x,
        top: full ? (compact ? 0 : 8) : win.y,
        width: full ? (compact ? "100%" : "calc(100% - 16px)") : win.w,
        height: full ? (compact ? "100%" : "calc(100% - 16px)") : win.h,
        zIndex: win.z,
        display: win.minimized ? "none" : undefined,
        background: "linear-gradient(180deg, rgba(20,28,38,0.94) 0%, rgba(12,18,26,0.96) 100%)",
      }}
      onPointerDownCapture={() => !active && focus(win.id)}
    >
      <header
        className={`flex h-10 shrink-0 touch-none items-center justify-between border-b border-white/[0.06] bg-white/[0.03] px-2.5 ${
          full ? "" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={start("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => !compact && toggleMaximize(win.id)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-white/[0.08] bg-white/[0.06]">
            <Icon size={14} color={program.color} aria-hidden />
          </div>
          <h2 className="mono truncate text-[11px] font-semibold tracking-wide">{program.title}</h2>
        </div>
        <div className="flex items-center gap-0.5">
          <button aria-label="Minimize" onClick={() => minimize(win.id)} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white/10">
            <Minus size={13} />
          </button>
          {!compact && (
            <button
              aria-label={win.maximized ? "Restore" : "Maximize"}
              onClick={() => toggleMaximize(win.id)}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white/10"
            >
              {win.maximized ? <Square size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
          <button aria-label="Close" onClick={() => close(win.id)} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-red-500/20 hover:text-red-300">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#0a1218]/60">
        <ProgramErrorBoundary name={program.short}>
          <Suspense
            fallback={
              <div className="p-4">
                <Spinner label={`Loading ${program.short}…`} />
              </div>
            }
          >
            <Program windowId={win.id} args={win.args} />
          </Suspense>
        </ProgramErrorBoundary>
      </div>
      {!full && (
        <div
          aria-hidden
          className="absolute right-0 bottom-0 z-10 h-5 w-5 cursor-nwse-resize touch-none"
          onPointerDown={start("resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <div className="absolute right-1 bottom-1 h-3 w-3 opacity-30">
            <div className="mb-[2px] h-px w-full bg-white" />
            <div className="mb-[2px] h-px w-full bg-white" />
            <div className="ml-auto h-px w-[60%] bg-white" />
          </div>
        </div>
      )}
    </section>
  );
}
