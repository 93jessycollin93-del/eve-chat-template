import { hierarchy, pack, type HierarchyCircularNode } from "d3-hierarchy";
import { Layers, ZoomOut } from "lucide-react";
import { useMemo, useState } from "react";
import { formatBytes } from "../lib/bytes";
import { fileSize, isMarker, type FileRecord } from "../lib/fs";
import { basename, extname, isWithin } from "../lib/paths";
import { isSealedPath, META_PATH } from "../lib/vault";
import { useFiles } from "../os/hooks";
import { useOs } from "../os/OsContext";
import type { ProgramProps } from "../os/programs";
import { Btn, ProgramHeader, SourceChip } from "../ui/ui";

interface Node {
  name: string;
  path: string;
  file?: FileRecord;
  bytes: number;
  children?: Node[];
}

const PALETTE = ["#00FF88", "#5ee9ff", "#ff7ad1", "#ffe66a", "#a78bfa", "#ff8c42", "#7cffc1", "#ffd27a"];

function colorFor(path: string): string {
  if (isWithin(path, "/Vault")) return "#ff5050";
  const top = path.split("/")[1] ?? "";
  let h = 0;
  for (const ch of top) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function buildTree(files: FileRecord[], root: string): Node {
  const top: Node = { name: root === "/" ? "/" : basename(root), path: root, bytes: 0, children: [] };
  for (const f of files) {
    if (isMarker(f) || !isWithin(f.path, root) || f.path === root) continue;
    const rel = f.path.slice(root === "/" ? 1 : root.length + 1).split("/");
    let node = top;
    let acc = root === "/" ? "" : root;
    for (let i = 0; i < rel.length - 1; i++) {
      acc += `/${rel[i]}`;
      let child = node.children!.find((c) => c.children && c.name === rel[i]);
      if (!child) {
        child = { name: rel[i], path: acc, bytes: 0, children: [] };
        node.children!.push(child);
      }
      node = child;
    }
    node.children!.push({ name: rel[rel.length - 1], path: f.path, file: f, bytes: fileSize(f) });
  }
  return top;
}

export default function Foam(_: ProgramProps) {
  const { files } = useFiles();
  const { open } = useOs();
  const [root, setRoot] = useState("/");
  const [selected, setSelected] = useState<Node | null>(null);
  const SIZE = 600;

  const nodes = useMemo(() => {
    const tree = buildTree(files, root);
    // Floor at 64 bytes so empty and tiny files still show as visible bubbles.
    const h = hierarchy<Node>(tree, (n) => n.children).sum((n) => (n.children ? 0 : Math.max(n.bytes, 64)));
    return pack<Node>().size([SIZE, SIZE]).padding(6)(h).descendants();
  }, [files, root]);

  const totalBytes = nodes[0]?.value ? nodes.filter((n) => n.data.file).reduce((s, n) => s + n.data.bytes, 0) : 0;
  const fileCount = nodes.filter((n) => n.data.file).length;

  const clickNode = (n: HierarchyCircularNode<Node>) => {
    if (n.depth === 0) return;
    if (n.data.children) {
      setRoot(n.data.path);
      setSelected(null);
    } else setSelected(n.data);
  };

  const up = () => {
    if (root === "/") return;
    const parts = root.split("/").filter(Boolean);
    parts.pop();
    setRoot(parts.length ? `/${parts.join("/")}` : "/");
    setSelected(null);
  };

  return (
    <div className="flex h-full flex-col bg-[#0a1016]">
      <div className="space-y-2 border-b border-white/10 p-3">
        <ProgramHeader icon={Layers} color="#5ee9ff" title="FOAM EXPLORER — your storage as bubbles" chip={<SourceChip>d3 circle packing</SourceChip>} />
        <div className="mono flex flex-wrap items-center gap-2 text-[10px] text-white/60">
          <Btn icon={ZoomOut} disabled={root === "/"} onClick={up}>
            Zoom out further
          </Btn>
          <span className="truncate">
            {root} — {fileCount} files, {formatBytes(totalBytes)}. Bubble area = bytes. Tap a folder to zoom in.
          </span>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {fileCount === 0 ? (
          <div className="mono p-6 text-[11px] text-white/40">No files here yet. Foam grows as you write.</div>
        ) : (
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" role="img" aria-label={`Bubble map of ${root}`}>
            <defs>
              <radialGradient id="bubble" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
            </defs>
            {nodes.map((n) => {
              const isFolder = !!n.data.children;
              const color = colorFor(n.data.path);
              const isSel = selected?.path === n.data.path;
              const sealed = isSealedPath(n.data.path) || n.data.path === META_PATH;
              return (
                <g key={n.data.path} transform={`translate(${n.x},${n.y})`} onClick={() => clickNode(n)} className={n.depth > 0 ? "cursor-pointer" : ""}>
                  <title>
                    {sealed ? "Encrypted vault item" : n.data.path} — {formatBytes(isFolder ? (n.value ?? 0) : n.data.bytes)}
                  </title>
                  <circle
                    r={n.r}
                    fill={isFolder ? (n.depth === 0 ? "transparent" : "rgba(255,255,255,0.02)") : color}
                    fillOpacity={isFolder ? 1 : isSel ? 0.45 : 0.16}
                    stroke={isFolder ? color : isSel ? "#fff" : color}
                    strokeOpacity={n.depth === 0 ? 0.1 : isFolder ? 0.35 : 0.7}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  {!isFolder && <circle r={n.r} fill="url(#bubble)" pointerEvents="none" />}
                  {isFolder && n.depth > 0 && n.r > 26 && (
                    <text y={-n.r + 14} textAnchor="middle" className="mono" fontSize={11} fill={color} pointerEvents="none">
                      {n.data.name}/
                    </text>
                  )}
                  {!isFolder && n.r > 22 && (
                    <text textAnchor="middle" dy="0.35em" fontSize={Math.min(11, n.r / 3.2)} fill="rgba(255,255,255,0.85)" pointerEvents="none" className="mono">
                      {sealed ? "🔒" : n.data.name.length > n.r / 3.5 ? `${n.data.name.slice(0, Math.max(3, Math.floor(n.r / 3.5)))}…` : n.data.name}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {selected?.file && (
          <div className="mono absolute right-3 bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-white/10 bg-black/80 p-2.5 text-[10px] backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] text-white">{isSealedPath(selected.path) ? "Encrypted vault item" : selected.path}</div>
              <div className="text-white/50">
                {formatBytes(selected.bytes)} · {extname(selected.path) || "no extension"} · modified {new Date(selected.file.modified).toLocaleString()}
              </div>
            </div>
            {isSealedPath(selected.path) ? (
              <Btn onClick={() => open("vault")}>Open Vault</Btn>
            ) : (
              <Btn variant="soft" onClick={() => open("theorypad", { path: selected.path })}>
                Open
              </Btn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
