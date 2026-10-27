import { formatBytes } from "./bytes";
import { sha256Hex } from "./compression";
import { copy, fileBytes, fileSize, isDirectory, isMarker, isText, listDir, listFiles, mkdir, move, readFile, remove, writeText, type FileRecord } from "./fs";
import { basename, isWithin, normalizePath } from "./paths";

export interface ShellEnv {
  cwd: string;
  host: string;
  history: string[];
  /** Opens a program; returns false if the name is unknown. */
  open?: (target: string, args?: Record<string, string>) => boolean;
  systemInfo?: () => Promise<string[]>;
  requestPersistence?: () => Promise<string>;
}

export interface ShellResult {
  output: string[];
  cwd?: string;
  clear?: boolean;
  /** Ask y/n before running `run`. */
  confirm?: { prompt: string; run: () => Promise<string[]> };
}

export const HELP = [
  "Files:   ls [path]  cd <dir>  pwd  cat <file>  tree [dir]  find <text>  grep <text> [dir]",
  "Edit:    echo <text> > file   echo <text> >> file   touch <file>  mkdir <dir>",
  "Manage:  mv <src> <dst>  cp <src> <dst>  rm [-r] <path>  wc <file>  du [dir]  sha256sum <file>",
  "System:  df  persist  systeminfo  whoami  date  ver  history  clear  open <program|file>",
  "Tips:    paths can be relative (../Theory). Quote names with spaces: cat \"my file.txt\"",
];

/** Split a command line into words, honoring quotes and > / >> redirects. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === ">") {
      if (has) out.push(cur);
      cur = "";
      has = false;
      if (line[i + 1] === ">") {
        out.push(">>");
        i++;
      } else out.push(">");
    } else if (/\s/.test(ch)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) throw new Error("Unclosed quote");
  if (has) out.push(cur);
  return out;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}

function treeLines(files: FileRecord[], dir: string, prefix = ""): string[] {
  const { folders, files: here } = listDir(files, dir);
  const items = [...folders.map((f) => ({ name: `${f}/`, dir: dir === "/" ? `/${f}` : `${dir}/${f}` })), ...here.map((f) => ({ name: basename(f.path), dir: "" }))];
  const out: string[] = [];
  items.forEach((item, i) => {
    const last = i === items.length - 1;
    out.push(`${prefix}${last ? "└── " : "├── "}${item.name}`);
    if (item.dir) out.push(...treeLines(files, item.dir, prefix + (last ? "    " : "│   ")));
  });
  return out;
}

async function resolveFile(files: FileRecord[], arg: string, cwd: string): Promise<FileRecord | undefined> {
  const p = normalizePath(arg, cwd);
  return files.find((f) => f.path === p) ?? (await readFile(p));
}

export async function runCommand(line: string, env: ShellEnv): Promise<ShellResult> {
  const words = tokenize(line);
  if (words.length === 0) return { output: [] };
  const [rawCmd, ...args] = words;
  const cmd = rawCmd.toLowerCase();
  const cwd = env.cwd;
  const path = (a: string) => normalizePath(a, cwd);
  const files = await listFiles();
  const needArg = (n: number, usage: string) => {
    if (args.length < n) throw new Error(`Usage: ${usage}`);
  };

  switch (cmd) {
    case "help":
    case "?":
      return { output: HELP };

    case "clear":
    case "cls":
      return { output: [], clear: true };

    case "pwd":
      return { output: [cwd] };

    case "cd": {
      const target = path(args[0] ?? "/");
      if (!isDirectory(files, target)) throw new Error(`No such folder: ${target}`);
      return { output: [], cwd: target };
    }

    case "ls":
    case "dir": {
      const target = path(args.find((a) => !a.startsWith("-")) ?? ".");
      const exact = files.find((f) => f.path === target);
      if (exact) return { output: [`${String(fileSize(exact)).padStart(9)}  ${fmtDate(exact.modified)}  ${basename(exact.path)}`] };
      if (!isDirectory(files, target)) throw new Error(`No such file or folder: ${target}`);
      const { folders, files: here } = listDir(files, target);
      const out = folders.map((f) => `${"<DIR>".padStart(9)}  ${" ".repeat(16)}  ${f}/`);
      for (const f of here) out.push(`${String(fileSize(f)).padStart(9)}  ${fmtDate(f.modified)}  ${basename(f.path)}`);
      const total = here.reduce((n, f) => n + fileSize(f), 0);
      out.push(`${here.length} file(s), ${formatBytes(total)}; ${folders.length} folder(s)`);
      return { output: out };
    }

    case "tree": {
      const target = path(args[0] ?? ".");
      if (!isDirectory(files, target)) throw new Error(`No such folder: ${target}`);
      return { output: [target, ...treeLines(files, target)] };
    }

    case "cat":
    case "type": {
      needArg(1, "cat <file>");
      const out: string[] = [];
      for (const a of args) {
        const f = await resolveFile(files, a, cwd);
        if (!f) throw new Error(`No such file: ${path(a)}`);
        if (!isText(f)) out.push(`(${basename(f.path)} is a binary file, ${formatBytes(fileSize(f))}. Use sha256sum, or open it in File Explorer.)`);
        else out.push(...f.content.replace(/\n$/, "").split("\n"));
      }
      return { output: out };
    }

    case "echo": {
      const redirect = args.findIndex((a) => a === ">" || a === ">>");
      if (redirect < 0) return { output: [args.join(" ")] };
      const target = args[redirect + 1];
      if (!target) throw new Error("Missing file name after >");
      const text = args.slice(0, redirect).join(" ");
      const p = path(target);
      if (isDirectory(files, p)) throw new Error(`${p} is a folder`);
      const existing = files.find((f) => f.path === p);
      const content = args[redirect] === ">>" && existing && isText(existing) ? `${existing.content}${existing.content.endsWith("\n") || !existing.content ? "" : "\n"}${text}\n` : `${text}\n`;
      const rec = await writeText(p, content);
      return { output: [`Wrote ${formatBytes(fileSize(rec))} to ${p}`] };
    }

    case "touch": {
      needArg(1, "touch <file>");
      for (const a of args) {
        const p = path(a);
        const f = files.find((x) => x.path === p);
        if (f && !isText(f)) throw new Error(`${p} is binary; not touching it`);
        await writeText(p, f?.content ?? "");
      }
      return { output: [] };
    }

    case "mkdir": {
      needArg(1, "mkdir <folder>");
      for (const a of args) await mkdir(path(a));
      return { output: args.map((a) => `Created ${path(a)}/`) };
    }

    case "rm":
    case "del":
    case "rmdir": {
      const recursive = args.some((a) => a === "-r" || a === "-rf" || a === "/s");
      const targets = args.filter((a) => !a.startsWith("-") && a !== "/s");
      if (targets.length === 0) throw new Error("Usage: rm [-r] <path>");
      const p = path(targets[0]);
      if (p === "/") throw new Error("Refusing to delete everything. Use Memory Map to back up first, then delete folders one by one.");
      const isFile = files.some((f) => f.path === p);
      const inside = files.filter((f) => isWithin(f.path, p) && !isMarker(f));
      if (!isFile && !isDirectory(files, p)) throw new Error(`No such file or folder: ${p}`);
      if (!isFile && !recursive) throw new Error(`${p} is a folder; use rm -r ${targets[0]}`);
      const what = isFile ? `${p} (${formatBytes(fileSize(files.find((f) => f.path === p)!))})` : `${p}/ and ${inside.length} file(s) inside`;
      const vaultWarning = isWithin("/Vault/.vault.json", p) ? " WARNING: this includes the vault's key settings; without them no sealed item can ever be decrypted." : "";
      return {
        output: [],
        confirm: {
          prompt: `Delete ${what}?${vaultWarning} This cannot be undone. (y/n)`,
          run: async () => {
            const n = await remove(p);
            return [`Deleted ${n} file(s).`];
          },
        },
      };
    }

    case "mv":
    case "move":
    case "ren":
    case "rename": {
      needArg(2, "mv <source> <destination>");
      const n = await move(path(args[0]), path(args[1]));
      return { output: [`Moved ${n} file(s).`] };
    }

    case "cp":
    case "copy": {
      needArg(2, "cp <source> <destination>");
      const n = await copy(path(args[0]), path(args[1]));
      return { output: [`Copied ${n} file(s).`] };
    }

    case "find": {
      needArg(1, "find <text in file name>");
      const q = args.join(" ").toLowerCase();
      const hits = files.filter((f) => !isMarker(f) && f.path.toLowerCase().includes(q)).map((f) => f.path);
      return { output: hits.length ? hits : [`No file names contain "${q}"`] };
    }

    case "grep": {
      needArg(1, "grep <text> [folder]");
      const q = args[0].toLowerCase();
      const scope = path(args[1] ?? "/");
      const out: string[] = [];
      for (const f of files) {
        if (!isText(f) || isMarker(f) || !isWithin(f.path, scope)) continue;
        f.content.split("\n").forEach((l, i) => {
          if (l.toLowerCase().includes(q)) out.push(`${f.path}:${i + 1}: ${l.trim().slice(0, 160)}`);
        });
      }
      return { output: out.length ? out.slice(0, 200) : [`No matches for "${args[0]}"`] };
    }

    case "wc": {
      needArg(1, "wc <file>");
      const f = await resolveFile(files, args[0], cwd);
      if (!f) throw new Error(`No such file: ${path(args[0])}`);
      if (!isText(f)) return { output: [`${fileSize(f)} bytes (binary)`] };
      const lines = f.content ? f.content.split("\n").length - (f.content.endsWith("\n") ? 1 : 0) : 0;
      const words = f.content.split(/\s+/).filter(Boolean).length;
      return { output: [`${lines} lines, ${words} words, ${fileSize(f)} bytes  ${f.path}`] };
    }

    case "du": {
      const target = path(args[0] ?? ".");
      if (!isDirectory(files, target)) throw new Error(`No such folder: ${target}`);
      const { folders, files: here } = listDir(files, target);
      const sizeOf = (dir: string) => files.filter((f) => isWithin(f.path, dir)).reduce((n, f) => n + fileSize(f), 0);
      const out = folders.map((f) => {
        const d = target === "/" ? `/${f}` : `${target}/${f}`;
        return `${formatBytes(sizeOf(d)).padStart(10)}  ${f}/`;
      });
      const loose = here.reduce((n, f) => n + fileSize(f), 0);
      if (here.length) out.push(`${formatBytes(loose).padStart(10)}  (${here.length} file(s) here)`);
      out.push(`${formatBytes(sizeOf(target)).padStart(10)}  total`);
      return { output: out };
    }

    case "sha256sum":
    case "hash": {
      needArg(1, "sha256sum <file>");
      const out: string[] = [];
      for (const a of args) {
        const f = await resolveFile(files, a, cwd);
        if (!f) throw new Error(`No such file: ${path(a)}`);
        out.push(`${await sha256Hex(fileBytes(f))}  ${f.path}`);
      }
      return { output: out };
    }

    case "df": {
      const est = await navigator.storage?.estimate?.();
      if (!est) return { output: ["This browser does not report storage usage."] };
      const used = est.usage ?? 0;
      const quota = est.quota ?? 0;
      return {
        output: [
          `Used:      ${formatBytes(used)} (${quota ? ((used / quota) * 100).toFixed(2) : "?"}%)`,
          `Available: ${formatBytes(Math.max(0, quota - used))} of ${formatBytes(quota)}`,
          `Files:     ${files.filter((f) => !isMarker(f)).length} in the Foundry filesystem`,
        ],
      };
    }

    case "persist":
      return { output: [env.requestPersistence ? await env.requestPersistence() : "Not available here."] };

    case "systeminfo":
      return { output: env.systemInfo ? await env.systemInfo() : [] };

    case "whoami":
    case "hostname":
      return { output: [env.host] };

    case "date":
      return { output: [new Date().toString()] };

    case "ver":
    case "version":
    case "uname":
      return { output: [`Sovereign Foundry v${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"} — ${navigator.userAgent}`] };

    case "history":
      return { output: env.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`) };

    case "open":
    case "start": {
      needArg(1, "open <program|file>");
      const target = args.join(" ");
      const f = files.find((x) => x.path === path(target));
      if (f) {
        env.open?.("theorypad", { path: f.path });
        return { output: [`Opening ${f.path}`] };
      }
      if (isDirectory(files, path(target)) && target.includes("/")) {
        env.open?.("explorer", { dir: path(target) });
        return { output: [`Opening ${path(target)}/ in File Explorer`] };
      }
      if (env.open?.(target.toLowerCase())) return { output: [`Starting ${target}`] };
      throw new Error(`Unknown program or file: ${target}`);
    }

    default:
      throw new Error(`'${rawCmd}' is not a command. Type help.`);
  }
}

/** Completes the last word of a command line against file and folder names. */
export function complete(line: string, files: FileRecord[], cwd: string): string {
  const m = /^(.*?)(\S*)$/.exec(line);
  if (!m) return line;
  const [, head, word] = m;
  const dirPart = word.includes("/") ? word.slice(0, word.lastIndexOf("/") + 1) : "";
  const stem = word.slice(dirPart.length).toLowerCase();
  const dir = normalizePath(dirPart || ".", cwd);
  const { folders, files: here } = listDir(files, dir);
  const names = [...folders.map((f) => `${f}/`), ...here.map((f) => basename(f.path))].filter((n) => n.toLowerCase().startsWith(stem));
  if (names.length === 0) return line;
  if (names.length === 1) return `${head}${dirPart}${names[0]}`;
  let prefix = names[0];
  for (const n of names) while (!n.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  return `${head}${dirPart}${prefix.length > stem.length ? prefix : word.slice(dirPart.length)}`;
}

