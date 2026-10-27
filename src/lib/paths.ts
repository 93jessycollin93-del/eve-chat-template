/**
 * Paths in the Foundry filesystem are absolute, slash-separated, and never end
 * in a slash (except the root, "/").
 */
export function normalizePath(input: string, cwd = "/"): string {
  const raw = input.trim();
  const base = raw.startsWith("/") ? raw : `${cwd}/${raw}`;
  const parts: string[] = [];
  for (const part of base.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function basename(path: string): string {
  if (path === "/") return "/";
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function joinPath(dir: string, name: string): string {
  return normalizePath(dir === "/" ? `/${name}` : `${dir}/${name}`);
}

/** True when `path` is `dir` itself or anything inside it. */
export function isWithin(path: string, dir: string): boolean {
  if (dir === "/") return true;
  return path === dir || path.startsWith(`${dir}/`);
}

export function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Top-level folder of a path ("/Theory/a.md" -> "Theory"), or "" for root files. */
export function topLevel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "";
}
