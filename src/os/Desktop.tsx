import { FilePlus, Layers, Lock, LockOpen, Menu, Pencil, RefreshCw, Search, Terminal as TerminalIcon, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes } from "../lib/bytes";
import { fileSize, isMarker, uniquePath, writeText } from "../lib/fs";
import { lockVault } from "../lib/vault-session";
import { useFiles, useMediaQuery, useNow, useOnline, useVaultSession } from "./hooks";
import { Launcher } from "./Launcher";
import { useOs } from "./OsContext";
import { PROGRAM_IDS, PROGRAMS, type ProgramId } from "./programs";
import { applyUpdate, usePwa } from "./pwa";
import { Window } from "./Window";

function Background() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,255,136,0.15) 1px, transparent 0)", backgroundSize: "36px 36px" }}
      />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(800px 500px at 20% 30%, rgba(0,255,136,0.08), transparent), radial-gradient(600px 600px at 80% 70%, rgba(94,233,255,0.06), transparent), radial-gradient(500px 400px at 50% 90%, rgba(255,122,209,0.05), transparent)",
        }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-[0.06]">
        <defs>
          <pattern id="foam" width="120" height="120" patternUnits="userSpaceOnUse">
            <circle cx="30" cy="30" r="18" fill="none" stroke="#00FF88" strokeWidth="0.5" />
            <circle cx="80" cy="50" r="28" fill="none" stroke="#5ee9ff" strokeWidth="0.4" />
            <circle cx="60" cy="90" r="14" fill="none" stroke="white" strokeWidth="0.3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#foam)" />
      </svg>
    </div>
  );
}

function DesktopIcon({ id, touch, selected, onSelect }: { id: ProgramId; touch: boolean; selected: boolean; onSelect: () => void }) {
  const { open } = useOs();
  const p = PROGRAMS[id];
  const Icon = p.icon;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (touch) open(id);
        else onSelect();
      }}
      onDoubleClick={() => !touch && open(id)}
      onKeyDown={(e) => e.key === "Enter" && !touch && open(id)}
      title={`${p.title} — ${p.desc}`}
      className={`group flex w-[86px] flex-col items-center gap-1.5 rounded-[10px] border p-2 transition ${
        selected ? "border-white/15 bg-white/[0.08]" : "border-transparent hover:border-white/[0.08] hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex h-[44px] w-[44px] items-center justify-center rounded-[12px] border border-white/[0.08] bg-[var(--surface-glass)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-xl transition group-hover:shadow-[0_8px_24px_rgba(0,255,136,0.15)]">
        <Icon size={20} color={p.color} aria-hidden />
      </div>
      <span className="mono max-w-[84px] text-center text-[9px] leading-[11px] tracking-tight break-words text-white/85">{p.title}</span>
    </button>
  );
}

function StartMenu({ onClose, fileCount, bytes }: { onClose: () => void; fileCount: number; bytes: number }) {
  const { open, hostName, setHostName, setLauncherOpen } = useOs();
  const vault = useVaultSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hostName);
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-[60px] left-2 z-[120] w-[360px] max-w-[calc(100vw-16px)] overflow-hidden rounded-[18px] border border-white/12 bg-[#101821]/95 shadow-[0_32px_80px_rgba(0,0,0,0.7)] backdrop-blur-[26px]"
    >
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-accent font-bold text-black">{hostName.slice(0, 1).toUpperCase() || "?"}</div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setHostName(draft.trim() || "Jessy");
                setEditing(false);
              }}
            >
              <input
                autoFocus
                value={draft}
                maxLength={40}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  setHostName(draft.trim() || "Jessy");
                  setEditing(false);
                }}
                aria-label="Host name"
                className="mono h-7 w-full rounded border border-white/15 bg-black px-2 text-[12px] outline-none"
              />
            </form>
          ) : (
            <button className="flex items-center gap-1.5 text-[13px] font-semibold" onClick={() => setEditing(true)} title="Rename host">
              {hostName}.exe // Sovereign Foundry <Pencil size={10} className="opacity-50" />
            </button>
          )}
          <div className="mono text-[10px] text-white/55">
            {fileCount} files · {formatBytes(bytes)} · vault {vault.key ? "unlocked" : "locked"}
          </div>
        </div>
      </div>
      <div className="grid max-h-[min(380px,50vh)] grid-cols-1 gap-0.5 overflow-auto p-2">
        {PROGRAM_IDS.map((id) => {
          const p = PROGRAMS[id];
          const Icon = p.icon;
          return (
            <button
              key={id}
              onClick={() => {
                open(id);
                onClose();
              }}
              className="flex items-center gap-3 rounded-[12px] border border-transparent px-3 py-2 text-left transition hover:border-white/10 hover:bg-white/[0.06]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.06]">
                <Icon size={16} color={p.color} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium">{p.title}</div>
                <div className="mono truncate text-[10px] text-white/55">{p.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 border-t border-white/10 p-2">
        <button
          className="mono flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] bg-white/[0.06] text-[11px] hover:bg-white/[0.09]"
          onClick={() => {
            setLauncherOpen(true);
            onClose();
          }}
        >
          <Search size={12} /> Search
        </button>
        {vault.key && (
          <button className="mono flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] bg-danger/10 text-[11px] text-red-300 hover:bg-danger/20" onClick={lockVault}>
            <Lock size={12} /> Lock vault
          </button>
        )}
        <button className="mono flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] bg-white/[0.06] text-[11px] hover:bg-white/[0.09]" onClick={() => location.reload()}>
          <RefreshCw size={12} /> Reboot
        </button>
      </div>
    </div>
  );
}

export function Desktop() {
  const os = useOs();
  const { files } = useFiles();
  const vault = useVaultSession();
  const pwa = usePwa();
  const online = useOnline();
  const now = useNow();
  const touch = useMediaQuery("(pointer: coarse)");
  const compact = useMediaQuery("(max-width: 699px)");
  const [startOpen, setStartOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<ProgramId | null>(null);
  const [zoomedOut, setZoomedOut] = useState(false);

  const realFiles = files.filter((f) => !isMarker(f));
  const bytes = realFiles.reduce((n, f) => n + fileSize(f), 0);
  const visible = os.windows.filter((w) => !w.minimized);
  const topVisible = visible.length ? visible.reduce((a, b) => (b.z > a.z ? b : a)).id : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        os.setLauncherOpen(!os.launcherOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [os]);

  const newTextFile = async () => {
    const path = uniquePath(files, "/Untitled.txt");
    await writeText(path, "");
    os.open("theorypad", { path });
  };

  const closeMenus = () => {
    setMenu(null);
    setStartOpen(false);
    setSelected(null);
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-ink select-none" style={{ paddingTop: "var(--safe-top)" }}>
      <Background />
      <main
        className="relative z-10 min-h-0 flex-1 overflow-hidden"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("section")) return;
          e.preventDefault();
          setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 260) });
        }}
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest("[data-menu]")) closeMenus();
        }}
        style={{
          transform: zoomedOut && !compact ? "scale(0.72)" : undefined,
          transformOrigin: "center center",
          transition: "transform 0.6s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <nav aria-label="Programs" className="absolute inset-0 overflow-auto p-3">
          <div className={compact ? "grid grid-cols-4 justify-items-center gap-1" : "flex h-full flex-col flex-wrap content-start gap-1"}>
            {PROGRAM_IDS.map((id) => (
              <DesktopIcon key={id} id={id} touch={touch} selected={selected === id} onSelect={() => setSelected(id)} />
            ))}
          </div>
        </nav>

        {os.windows.map((w) => (
          <Window key={w.id} win={w} compact={compact} active={w.id === topVisible} />
        ))}

        {menu && (
          <div
            data-menu
            role="menu"
            className="fixed z-[130] min-w-[210px] overflow-hidden rounded-[12px] border border-white/10 bg-[#141c26]/95 py-1 shadow-2xl backdrop-blur-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            {[
              { icon: FilePlus, label: "New text file", run: newTextFile },
              { icon: TerminalIcon, label: "Open terminal", run: () => os.open("terminal") },
              { icon: Search, label: "Search… (Ctrl+K)", run: () => os.setLauncherOpen(true) },
              ...(!compact ? [{ icon: Layers, label: zoomedOut ? "Zoom in closer" : "Zoom out further", run: () => setZoomedOut((z) => !z) }] : []),
              ...(vault.key ? [{ icon: Lock, label: "Lock vault now", run: lockVault }] : []),
            ].map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className="mono flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-white/10"
                onClick={() => {
                  setMenu(null);
                  void item.run();
                }}
              >
                <item.icon size={12} /> {item.label}
              </button>
            ))}
          </div>
        )}
      </main>

      <footer
        className="relative z-[110] flex shrink-0 items-center gap-2 border-t border-white/[0.08] bg-[#0e141c]/90 px-2.5 backdrop-blur-[28px]"
        style={{ height: "calc(52px + var(--safe-bottom))", paddingBottom: "var(--safe-bottom)" }}
      >
        <button
          data-menu
          aria-label="Start menu"
          aria-expanded={startOpen}
          onClick={() => {
            setMenu(null);
            setStartOpen((s) => !s);
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-black shadow-[0_0_20px_rgba(0,255,136,0.4)] transition hover:brightness-110"
        >
          <Menu size={18} />
        </button>
        <div className="h-6 w-px bg-white/10" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {os.windows.map((w) => {
            const p = PROGRAMS[w.programId];
            const Icon = p.icon;
            const isTop = w.id === topVisible;
            return (
              <button
                key={w.id}
                aria-label={p.title}
                onClick={() => (w.minimized ? os.focus(w.id) : isTop ? os.minimize(w.id) : os.focus(w.id))}
                className={`mono flex h-9 shrink-0 items-center gap-2 rounded-[10px] border px-2.5 text-[11px] transition ${
                  !w.minimized ? "border-white/15 bg-white/[0.09] text-white" : "border-transparent text-white/50 hover:bg-white/5"
                }`}
              >
                <Icon size={14} color={w.minimized ? "#7a8a83" : p.color} aria-hidden />
                <span className="hidden max-w-[110px] truncate lg:inline">{p.short}</span>
                {!w.minimized && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={() => os.open("vault")}
            title={vault.key ? "Vault unlocked" : "Vault locked"}
            className="mono hidden h-9 items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.06] px-3 text-[10px] md:flex"
          >
            {online ? <Wifi size={11} className="text-accent" /> : <WifiOff size={11} className="text-gold" />}
            <span>
              {realFiles.length} FILES · {formatBytes(bytes)}
            </span>
            {vault.key ? <LockOpen size={11} className="text-gold" /> : <Lock size={11} className="text-white/50" />}
          </button>
          <div className="mono text-right leading-none">
            <div className="text-[11px] font-semibold tracking-wide">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            <div className="mt-[2px] text-[8px] text-white/55">{now.toLocaleDateString([], { month: "short", day: "numeric" })}</div>
          </div>
          <button
            aria-label="Search"
            onClick={() => os.setLauncherOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-white/10 bg-white/10"
          >
            <Search size={14} className="opacity-70" />
          </button>
        </div>
        {startOpen && <StartMenu onClose={() => setStartOpen(false)} fileCount={realFiles.length} bytes={bytes} />}
      </footer>

      {pwa.needRefresh && (
        <div role="status" className="mono fixed top-3 left-1/2 z-[160] flex -translate-x-1/2 items-center gap-3 rounded-[12px] border border-accent/30 bg-[#101821]/95 px-3 py-2 text-[11px] shadow-2xl">
          A new version of Sovereign Foundry is ready.
          <button className="rounded bg-accent px-2 py-1 font-semibold text-black" onClick={() => void applyUpdate()}>
            Reload
          </button>
        </div>
      )}
      {os.launcherOpen && <Launcher />}
    </div>
  );
}
