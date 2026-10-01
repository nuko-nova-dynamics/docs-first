// POSIX path helpers: the mod runtime has no node:path.

export function dirname(path: string): string {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  return i === 0 ? "/" : p.slice(0, i);
}

export function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || "";
}

export function join(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

/** `path` made absolute against `cwd`, with `.` and `..` segments resolved. */
export function resolve(cwd: string, path: string): string {
  const raw = path.startsWith("/") ? path : join(cwd || "/", path);
  const out: string[] = [];
  for (const seg of raw.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

/** `path` relative to `cwd` when it lies beneath it, otherwise unchanged. */
export function shorten(cwd: string, path: string): string {
  const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return cwd && path.startsWith(base) ? path.slice(base.length) : path;
}
