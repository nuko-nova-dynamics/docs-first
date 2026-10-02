// One entry per package ecosystem: which commands change dependencies, which commands
// look packages up, which URLs are its registry, and the lookup that produces evidence.
// Supporting another ecosystem means adding one entry here.

import type { Ecosystem, Subject } from "./model.ts";
import { commands, head } from "./shell.ts";

type Entry = {
  id: Ecosystem;
  /** Packages this simple command would add, upgrade, re-pin or scaffold. */
  changes(t: readonly string[]): string[];
  /** Packages this simple command looks up in the registry or reads from an install. */
  lookups(t: readonly string[]): string[];
  /** The package a registry page is about, or "" when the URL is not this ecosystem's registry. */
  registryPackage(host: string, segs: readonly string[]): string;
  /** The command that produces registry evidence for one package. */
  remedy(name: string): string;
};

const NO_FLAGS: ReadonlySet<string> = new Set();

/** The words after `index` that are not flags or flag values. */
function argsAfter(t: readonly string[], index: number, valueFlags: ReadonlySet<string> = NO_FLAGS): string[] {
  const names: string[] = [];
  for (let i = index + 1; i < t.length; i += 1) {
    const word = t[i] ?? "";
    if (valueFlags.has(word)) { i += 1; continue; }
    if (!word.startsWith("-")) names.push(word);
  }
  return names;
}

/** The index of the first word at or after `from` that is neither a flag nor a flag's value; -1 when none. */
function subcommandIndex(t: readonly string[], from: number, valueFlags: ReadonlySet<string>): number {
  for (let i = from; i < t.length; i += 1) {
    const word = t[i] ?? "";
    if (valueFlags.has(word)) { i += 1; continue; }
    if (!word.startsWith("-")) return i;
  }
  return -1;
}

/** Packages named with `--package x`, `--package=x` or `-p x`: what a dlx or npx run fetches, whatever binary it then runs. */
function packageFlags(t: readonly string[]): string[] {
  const out: string[] = [];
  t.forEach((word, i) => {
    const inline = word.match(/^--package=(.+)$/);
    const value = t[i + 1];
    if (inline?.[1]) out.push(inline[1]);
    else if ((word === "--package" || word === "-p") && value) out.push(value);
  });
  return out;
}

// Programs that only read files: a node_modules path in their arguments means the package's own files were read.
const FILE_READERS = new Set(["cat", "head", "tail", "less", "more", "bat", "ls", "tree", "jq", "grep", "rg", "sed", "awk", "find", "wc", "file", "stat", "diff"]);

function installedPackagesRead(t: readonly string[]): string[] {
  if (!FILE_READERS.has(head(t))) return [];
  const names: string[] = [];
  for (const word of t.slice(1)) {
    const m = word.match(/node_modules\/((?:@[^/\s]+\/)?[^/\s@]+)/);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// npm and the package managers that share its registry
// ---------------------------------------------------------------------------

// Each manager's flags that take a value. They differ: npm's -w names a workspace, pnpm's -w is a switch.
const JS_VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  pnpm: new Set(["--filter", "-F", "-C", "--dir", "--registry", "--package", "--reporter", "--loglevel", "--config"]),
  npm: new Set(["-w", "--workspace", "--prefix", "--registry", "--tag", "--userconfig", "--cache", "--loglevel"]),
  yarn: new Set(["--cwd", "--registry"]),
  bun: new Set(["--cwd", "--registry", "--backend", "--filter", "-F"]),
  npx: new Set(["-p", "--package", "-w", "--workspace", "--prefix", "--registry", "--cache"]),
  bunx: new Set(["-p", "--package"])
};
const JS_CHANGE = new Set(["add", "install", "i", "up", "update", "upgrade"]);
// `exec` runs an installed binary and fetches nothing, so it is not listed.
const JS_FETCH_RUN: Record<string, Set<string>> = {
  pnpm: new Set(["dlx", "create"]),
  npm: new Set(["init"]),
  yarn: new Set(["dlx", "create"]),
  bun: new Set(["x", "create"])
};
const JS_VIEW = new Set(["view", "info", "show", "v"]);
const REGISTRY_FIELDS = new Set(["version", "versions", "dist-tags", "dist-tags.latest", "dependencies", "peerdependencies", "devdependencies", "engines", "repository", "homepage", "time", "description", "main", "exports", "types", "license", "name", "--json"]);

/**
 * The registry package a spec names: `@scope/pkg@1.2.3` → `@scope/pkg`, `zod@3` → `zod`,
 * and an alias `compat@npm:zod@3` → `zod`, the package actually fetched. "" for paths, git and workspace specs.
 */
export function npmPackageName(spec: string): string {
  let s = String(spec || "").trim();
  if (!s || s.startsWith("-")) return "";
  const alias = s.indexOf("@npm:");
  if (alias > 0) return npmPackageName(s.slice(alias + 5));
  if (/^(file:|link:|workspace:|portal:|github:|git\+|git:|https?:|ssh:|\.|\/|~)/.test(s)) return "";
  s = s.replace(/^npm:/, "");
  if (s.startsWith("@")) {
    const [scope = "", name = ""] = s.slice(1).split("/");
    const bare = name.split("@")[0] ?? "";
    return scope && bare ? `@${scope}/${bare}` : "";
  }
  return s.split("@")[0]?.split("/")[0] ?? "";
}

/** For a package manager command, the index of its subcommand, looking through `yarn workspace <name>` and `yarn npm`. */
function jsSubcommand(t: readonly string[], h: string): number {
  const flags = JS_VALUE_FLAGS[h] ?? NO_FLAGS;
  let idx = subcommandIndex(t, 1, flags);
  if (h === "yarn" && t[idx] === "workspace") idx = subcommandIndex(t, idx + 2, flags);
  if (h === "yarn" && t[idx] === "npm") idx = subcommandIndex(t, idx + 1, flags);
  return idx;
}

const npm: Entry = {
  id: "npm",
  changes(t) {
    const h = head(t);
    if (h in JS_FETCH_RUN) {
      const idx = jsSubcommand(t, h);
      if (idx < 0) return [];
      const sub = t[idx] ?? "";
      const flags = JS_VALUE_FLAGS[h] ?? NO_FLAGS;
      // A bare `pnpm install` or `pnpm up` names no package and installs from the lockfile or ranges.
      if (JS_CHANGE.has(sub)) return argsAfter(t, idx, flags).map(npmPackageName).filter(Boolean);
      if (JS_FETCH_RUN[h]?.has(sub)) {
        const flagged = packageFlags(t).map(npmPackageName).filter(Boolean);
        if (flagged.length) return flagged;
        const name = npmPackageName(argsAfter(t, idx, flags)[0] ?? "");
        if (!name) return [];
        const scaffolds = sub === "create" && !name.startsWith("create-") && !name.includes("/create-");
        return [scaffolds ? `create-${name}` : name];
      }
      return [];
    }
    if (h === "npx" || h === "bunx") {
      // npx runs an installed binary when one exists, so only an explicit fetch changes dependencies:
      // a scaffolder (create-*), a pinned spec (pkg@version), -p/--package, or -y/--yes.
      if (t.some((x) => /^(--version|-v|--help|-h)$/.test(x))) return [];
      const flagged = packageFlags(t);
      if (flagged.length) return flagged.map(npmPackageName).filter(Boolean);
      const spec = argsAfter(t, 0, JS_VALUE_FLAGS[h])[0] ?? "";
      const name = npmPackageName(spec);
      if (!name) return [];
      const pinned = spec.slice(spec.startsWith("@") ? 1 : 0).includes("@");
      const explicitYes = t.some((x) => x === "-y" || x === "--yes");
      return /^(@[^/]+\/)?create-/.test(name) || pinned || explicitYes ? [name] : [];
    }
    return [];
  },
  lookups(t) {
    const h = head(t);
    if (h in JS_FETCH_RUN) {
      const idx = jsSubcommand(t, h);
      if (idx < 0 || !JS_VIEW.has(t[idx] ?? "")) return [];
      return argsAfter(t, idx, JS_VALUE_FLAGS[h]).filter((x) => !REGISTRY_FIELDS.has(x.toLowerCase())).map(npmPackageName).filter(Boolean);
    }
    return installedPackagesRead(t);
  },
  registryPackage(host, segs) {
    // A scope and its name arrive as two path segments, or as one when the slash was percent-encoded.
    const scoped = (a: string, b: string) => (a.startsWith("@") && !a.includes("/") ? `${a}/${b}` : a);
    const [first = "", second = "", third = ""] = segs;
    if (host === "registry.npmjs.org" && first) return scoped(first, second);
    if (host === "npmjs.com" && first === "package" && second) return scoped(second, third);
    return "";
  },
  remedy: (name) => `pnpm view ${name} version`
};

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const PIP_VALUE_FLAGS = new Set(["-r", "-c", "-e", "--requirement", "--constraint", "--editable", "--index-url", "-i", "--extra-index-url", "--target", "-t"]);

const python: Entry = {
  id: "python",
  changes(t) {
    const h = head(t);
    const uvAdd = h === "uv" && t[1] === "add";
    if (!["pip", "pip3", "pipx", "uv"].includes(h) || !(t.includes("install") || uvAdd)) return [];
    const idx = t.indexOf(uvAdd ? "add" : "install");
    return argsAfter(t, idx, PIP_VALUE_FLAGS)
      .filter((w) => !/^(\.|\/|~)/.test(w) && !/\.(txt|whl|tar\.gz|zip)$/.test(w))
      .map((w) => w.replace(/[<>=!~[;].*$/, ""))
      .filter(Boolean);
  },
  lookups(t) {
    const h = head(t);
    if (h !== "pip" && h !== "pip3") return [];
    if (t[1] === "show") return argsAfter(t, 1);
    if (t[1] === "index" && t[2] === "versions") return argsAfter(t, 2);
    return [];
  },
  registryPackage: (host, segs) => (host === "pypi.org" && (segs[0] === "pypi" || segs[0] === "project") && segs[1] ? segs[1] : ""),
  remedy: (name) => `pip index versions ${name}`
};

// ---------------------------------------------------------------------------
// Homebrew, Cargo, Go
// ---------------------------------------------------------------------------

const withoutVersion = (spec: string) => spec.split("@")[0] ?? spec;
const withoutTap = (name: string) => name.replace(/^.*\//, "");
const CARGO_VALUE_FLAGS = new Set(["--features", "-F", "--rename", "--package", "-p", "--path", "--git", "--branch", "--tag", "--rev", "--registry", "--target", "--manifest-path"]);

const brew: Entry = {
  id: "brew",
  changes: (t) => (head(t) === "brew" && (t[1] === "install" || t[1] === "upgrade") ? argsAfter(t, 1).map(withoutTap) : []),
  lookups: (t) => (head(t) === "brew" && t[1] === "info" ? argsAfter(t, 1).map(withoutTap) : []),
  registryPackage: (host, segs) => (host === "formulae.brew.sh" && segs[1] ? segs[1].replace(/\.html$/, "") : ""),
  remedy: (name) => `brew info ${name}`
};

const cargo: Entry = {
  id: "cargo",
  changes: (t) => (head(t) === "cargo" && t[1] === "add" ? argsAfter(t, 1, CARGO_VALUE_FLAGS).map(withoutVersion) : []),
  lookups: (t) => (head(t) === "cargo" && (t[1] === "search" || t[1] === "info") ? argsAfter(t, 1, CARGO_VALUE_FLAGS) : []),
  registryPackage: (host, segs) => (host === "crates.io" && segs[0] === "crates" && segs[1] ? segs[1] : ""),
  remedy: (name) => `cargo info ${name}`
};

const go: Entry = {
  id: "go",
  changes: (t) => (head(t) === "go" && t[1] === "get" ? argsAfter(t, 1).map(withoutVersion) : []),
  lookups: (t) => (head(t) === "go" && t[1] === "list" ? argsAfter(t, 1).map(withoutVersion) : []),
  registryPackage: (host, segs) => (host === "pkg.go.dev" && segs.length ? withoutVersion(segs.join("/")) : ""),
  remedy: (name) => `go list -m -versions ${name}`
};

const ENTRIES: readonly Entry[] = [npm, python, brew, cargo, go];
const BY_ID = new Map(ENTRIES.map((e) => [e.id, e]));

function collect(tokenLists: readonly (readonly string[])[], pick: (entry: Entry, t: readonly string[]) => string[]): Subject[] {
  const seen = new Map<string, Subject>();
  for (const t of tokenLists) {
    for (const entry of ENTRIES) {
      for (const name of pick(entry, t)) seen.set(`${entry.id}:${name}`, { name, ecosystem: entry.id });
    }
  }
  return [...seen.values()];
}

/** Packages one simple command would add, upgrade, re-pin or scaffold. */
export function changesIn(tokens: readonly string[]): Subject[] {
  return collect([tokens], (entry, t) => entry.changes(t));
}

/** Packages one simple command looks up in a registry or reads from an install. */
export function lookupsIn(tokens: readonly string[]): Subject[] {
  return collect([tokens], (entry, t) => entry.lookups(t));
}

/** Packages a command line would add, upgrade, re-pin or scaffold. */
export function dependencyChanges(command: string): Subject[] {
  return collect(commands(command).map((s) => s.tokens), (entry, t) => entry.changes(t));
}

/** Packages a command line looks up in a registry or reads from an install. */
export function registryLookups(command: string): Subject[] {
  return collect(commands(command).map((s) => s.tokens), (entry, t) => entry.lookups(t));
}

/** The package a registry URL is about, or null. */
export function registryPackageFromUrl(url: string): Subject | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  for (const entry of ENTRIES) {
    const name = entry.registryPackage(host, segs);
    if (name) return { name, ecosystem: entry.id };
  }
  return null;
}

/** The one command that produces registry evidence for a subject. */
export function remedyFor(subject: Subject): string {
  return BY_ID.get(subject.ecosystem)!.remedy(subject.name);
}
