// Which tool calls are gated actions, and which subjects each one depends on.

import { dependencyChanges, npmPackageName } from "./ecosystems.ts";
import type { GatedAction, ProjectFiles, Subject, ToolCall } from "./model.ts";
import { basename, dirname, join, resolve } from "./paths.ts";

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const SOURCE_FILE_RE = /\.([cm]?[jt]sx?|vue|svelte|astro)$/i;
// Import, export-from and require statements only: never the word inside a longer word,
// a property path, or a string literal such as a kind name or an exports map key.
const IMPORT_RE = /(?:(?<![\w$.'"-])import\s*(?:[^'"`;]*?\bfrom\s*)?|(?<![\w$.'"-])export\s+[^'"`;]*?\bfrom\s*|(?<![\w$.'"-])require\s*\(\s*|(?<![\w$.'"-])import\s*\(\s*)["']([^"'\n]+)["']/g;

// Modules the runtime provides rather than a package: Node's built-ins, Bun's, and Claude Code's mod API.
const RUNTIME_MODULES = new Set([
  "assert", "assert/strict", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "dns/promises", "domain", "events", "fs", "fs/promises", "http", "http2",
  "https", "inspector", "inspector/promises", "module", "net", "os", "path", "path/posix", "path/win32", "perf_hooks",
  "process", "punycode", "querystring", "readline", "readline/promises", "repl", "stream", "stream/consumers",
  "stream/promises", "stream/web", "string_decoder", "sys", "timers", "timers/promises", "tls", "trace_events", "tty",
  "url", "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib",
  "bun", "claude-code", "claude-code/testing"
]);

/**
 * Source with its comments removed and its strings kept, so a commented-out statement is not read as
 * code and a comment inside a dynamic import's parentheses does not hide its specifier.
 */
export function stripComments(source: string): string {
  const src = String(source || "");
  let out = "";
  let quote = "";
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? "";
    const next = src[i + 1] ?? "";
    if (quote) {
      out += ch;
      if (ch === "\\") { out += next; i += 1; }
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close < 0 ? src.length : close + 1;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "/") {
      const close = src.indexOf("\n", i + 2);
      i = (close < 0 ? src.length : close) - 1;
      continue;
    }
    if (ch === "'" || ch === "\"" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

export function importSpecs(source: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(IMPORT_RE.source, "g");
  const code = stripComments(source);
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) if (m[1]) out.add(m[1]);
  return [...out];
}

/** The package an import specifier names, or "" for relative paths, aliases and runtime modules. */
export function specToPackage(spec: string): string {
  const s = String(spec || "").trim();
  if (!s || /^(\.|\/|~|#|@\/|\$|\?|http)/.test(s)) return "";
  if (RUNTIME_MODULES.has(s)) return "";
  // Scheme specifiers (node:fs, bun:sqlite, astro:content, cloudflare:workers) are runtime-provided, except npm:pkg.
  if (/^[a-z][a-z0-9-]*:/.test(s) && !s.startsWith("npm:")) return "";
  const clean = s.replace(/^npm:/, "");
  const segs = clean.split("/");
  return clean.startsWith("@") ? segs.slice(0, 2).join("/") : (segs[0] ?? "");
}

function parseJson(text: string | null): Record<string, any> | null {
  if (text == null || !text.trim()) return null;
  for (const candidate of [text, text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")]) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // try the lenient form next
    }
  }
  return null;
}

/** What a project declares, found by walking up from a file. */
export type Knowledge = { declared: Set<string>; aliasExact: Set<string>; aliasPrefixes: string[]; nodeModulesDirs: string[] };

/** A path alias key: `@ui/*` is a prefix, `react` matches only itself, and a bare `*` is ignored. */
function addAlias(knowledge: Knowledge, key: string): void {
  if (!key.endsWith("*")) knowledge.aliasExact.add(key);
  else if (key.length > 1) knowledge.aliasPrefixes.push(key.slice(0, -1));
}

/**
 * Walks up from the file's directory collecting declared dependencies, `imports` and tsconfig path
 * aliases, and node_modules folders. Null when no package.json lies above: the file is a scratch file
 * and the gate cannot judge its imports.
 */
export async function projectKnowledge(file: string, files: ProjectFiles, rootLimit = 8): Promise<Knowledge | null> {
  let dir = dirname(file);
  let sawPackageJson = false;
  const knowledge: Knowledge = { declared: new Set(), aliasExact: new Set(), aliasPrefixes: [], nodeModulesDirs: [] };
  for (let i = 0; i < rootLimit; i += 1) {
    const pkg = parseJson(await files.read(join(dir, "package.json")));
    if (pkg) {
      sawPackageJson = true;
      for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(pkg[key] || {})) knowledge.declared.add(name);
      }
      for (const key of Object.keys(pkg.imports || {})) addAlias(knowledge, key);
    }
    const tsconfig = parseJson(await files.read(join(dir, "tsconfig.json")));
    for (const key of Object.keys(tsconfig?.compilerOptions?.paths || {})) addAlias(knowledge, key);
    if (await files.exists(join(dir, "node_modules"))) knowledge.nodeModulesDirs.push(join(dir, "node_modules"));
    const atRoot = (await files.exists(join(dir, ".git"))) || (await files.exists(join(dir, "pnpm-workspace.yaml")));
    const parent = dirname(dir);
    if (parent === dir || (atRoot && sawPackageJson)) break;
    dir = parent;
  }
  return sawPackageJson ? knowledge : null;
}

async function isKnownPackage(pkg: string, spec: string, knowledge: Knowledge, files: ProjectFiles): Promise<boolean> {
  if (knowledge.declared.has(pkg)) return true;
  if (knowledge.aliasExact.has(spec) || knowledge.aliasPrefixes.some((p) => spec.startsWith(p))) return true;
  for (const nm of knowledge.nodeModulesDirs) if (await files.exists(join(nm, pkg))) return true;
  return false;
}

/** Packages this edit newly imports that the project neither declares nor has installed. */
export async function newUnknownImports(file: string, before: string, after: string, files: ProjectFiles): Promise<string[]> {
  if (!SOURCE_FILE_RE.test(file)) return [];
  const had = new Set(importSpecs(before));
  const added = importSpecs(after).filter((s) => !had.has(s));
  if (!added.length) return [];
  const knowledge = await projectKnowledge(file, files);
  if (!knowledge) return [];
  const out = new Set<string>();
  for (const spec of added) {
    const pkg = specToPackage(spec);
    if (pkg && !(await isKnownPackage(pkg, spec, knowledge, files))) out.add(pkg);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
// Specs that point at local folders, workspaces or git rather than the registry.
const NON_REGISTRY_SPEC_RE = /^(workspace:|link:|file:|portal:|git\+|git:|github:|https?:|ssh:|\.|\/|~)|^[\w.-]+\/[\w.-]+(#.*)?$/;

type Dependency = { spec: string; pkg: string };

/** The registry package a dependency entry fetches: its own name, or the target of an `npm:` alias. */
function dependencyOf(name: string, spec: string): Dependency {
  return { spec, pkg: (spec.startsWith("npm:") && npmPackageName(spec.slice(4))) || name };
}

/** A package.json's registry dependencies by name, or null when the text is not a JSON object. */
function manifestDependencies(text: string): Map<string, Dependency> | null {
  const json = parseJson(text);
  if (!json) return null;
  const deps = new Map<string, Dependency>();
  for (const section of DEP_SECTIONS) {
    const block = json[section];
    if (!block || typeof block !== "object") continue;
    for (const [name, spec] of Object.entries(block)) {
      if (typeof spec === "string" && !NON_REGISTRY_SPEC_RE.test(spec)) deps.set(name, dependencyOf(name, spec));
    }
  }
  return deps;
}

// For fragments that are not JSON on their own: a "name": "spec" pair whose spec is a version range, an alias or a dist-tag.
const MANIFEST_NON_DEP_KEYS = new Set(["name", "version", "type", "main", "types", "module", "license", "author", "description", "packageManager", "private", "node", "pnpm", "npm", "yarn", "bun", "engines", "browser", "homepage", "repository"]);
const DEP_PAIR_RE = /"((?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)"\s*:\s*"((?:[\^~>=<*]|\d|x\b|npm:)[^"]*|latest|next|canary|beta|rc)"/g;

function fragmentDependencies(text: string): Map<string, Dependency> {
  const deps = new Map<string, Dependency>();
  const re = new RegExp(DEP_PAIR_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || "")))) {
    const [, name, spec] = m;
    if (name && spec !== undefined && !MANIFEST_NON_DEP_KEYS.has(name)) deps.set(name, dependencyOf(name, spec));
  }
  return deps;
}

/** Registry packages this package.json change adds or re-pins: a new dependency, or a known one with a different spec. */
export function manifestChanges(before: string, after: string): string[] {
  const now = manifestDependencies(after);
  const was = now ? (manifestDependencies(before) ?? new Map<string, Dependency>()) : fragmentDependencies(before);
  const changed = new Set<string>();
  for (const [name, dep] of now ?? fragmentDependencies(after)) if (was.get(name)?.spec !== dep.spec) changed.add(dep.pkg);
  return [...changed];
}

// ---------------------------------------------------------------------------
// Sensitive files
// ---------------------------------------------------------------------------

export type SensitiveRule = { label: string; re: RegExp; vendors: string[] };

const SENSITIVE_RULES: readonly SensitiveRule[] = [
  {
    label: "database schema or migration",
    re: /(^|\/)(schema\.prisma|prisma\/migrations\/|migrations?\/[^/]+\.(sql|ts|js|py)$|convex\/schema\.[jt]s$|drizzle\/.*schema.*\.[jt]s$|[^/]*schema\.(sql|prisma)$|supabase\/migrations\/)/i,
    vendors: ["prisma", "drizzle", "convex", "supabase", "postgres", "sqlite", "mysql"]
  },
  {
    label: "auth or request middleware",
    re: /(^|\/)(middleware\.[jt]s$|proxy\.[jt]s$|o?auth\.[jt]s$|auth\.config\.[jt]s$|o?auth\/[^/]+\.[jt]sx?$|[^/]*(?:^|[-_.])o?auth(?:[-_.][^/]*)?\.[jt]sx?$)/i,
    vendors: ["auth", "clerk", "next-auth", "better-auth", "supabase", "firebase", "lucia", "passport", "jose"]
  },
  {
    // A keyword in the filename, or in a folder under an api/server/lib-style tree (api/stripe/webhook/route.ts).
    label: "billing or webhook handler",
    re: /(^|\/)[^/]*(webhook|billing|stripe|payment|checkout|subscription|revenuecat)[^/]*\.[jt]sx?$|(^|\/)(?:api|server|lib|services?|functions|convex|supabase|workers|handlers?)\/(?:[^/]+\/)*[^/]*(webhook|billing|stripe|payment|checkout|subscription|revenuecat)[^/]*\/[^/]+\.[jt]sx?$/i,
    vendors: ["stripe", "revenuecat", "lemonsqueezy", "paddle", "polar"]
  },
  {
    label: "deployment or CI config",
    re: /(^|\/)(vercel\.json|wrangler\.(toml|jsonc?)|fly\.toml|railway\.(toml|json)|netlify\.toml|render\.yaml|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|eas\.json|app\.config\.[jt]s|\.github\/workflows\/[^/]+\.ya?ml)$/i,
    vendors: ["vercel", "cloudflare", "wrangler", "fly", "railway", "netlify", "render", "docker", "expo", "eas", "github"]
  }
];

export function sensitiveRule(file: string): SensitiveRule | null {
  return SENSITIVE_RULES.find((r) => r.re.test(file)) ?? null;
}

const npmSubject = (name: string): Subject => ({ name, ecosystem: "npm" });

/** The libraries a sensitive file depends on: the packages it imports, and vendors its path names. */
export function sensitiveSubjects(file: string, before: string, after: string, rule: SensitiveRule): Subject[] {
  const names = new Set<string>();
  for (const spec of [...importSpecs(before), ...importSpecs(after)]) {
    const pkg = specToPackage(spec);
    if (pkg) names.add(pkg);
  }
  const lower = file.toLowerCase();
  for (const vendor of rule.vendors) if (lower.includes(vendor)) names.add(vendor);
  return [...names].map(npmSubject);
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

/**
 * The file's text before and after the call. An Edit is applied to the file on disk, so a fragment
 * that only swaps a version or a module name is judged in its full context; when the file cannot be
 * read or the fragment is not in it, the fragments themselves stand in.
 */
async function contents(call: ToolCall, file: string, files: ProjectFiles): Promise<{ before: string; after: string }> {
  if (call.tool === "Write") return { before: (await files.read(file)) ?? "", after: String(call.content ?? "") };
  const oldString = String(call.old_string ?? "");
  const newString = String(call.new_string ?? "");
  const current = oldString ? await files.read(file) : null;
  if (current !== null && current.includes(oldString)) {
    const after = call.replace_all === true ? current.split(oldString).join(newString) : current.replace(oldString, () => newString);
    return { before: current, after };
  }
  return { before: oldString, after: newString };
}

/** The gated actions a tool call would take; empty for every call the gate leaves alone. */
export async function classify(call: ToolCall, files: ProjectFiles, cwd: string): Promise<GatedAction[]> {
  if (call.tool === "Bash") {
    const subjects = dependencyChanges(String(call.command ?? ""));
    return subjects.length ? [{ kind: "dependency-change", via: "command", subjects }] : [];
  }
  if (call.tool !== "Edit" && call.tool !== "Write") return [];
  const rawPath = String(call.file_path ?? "");
  if (!rawPath) return [];
  const file = resolve(cwd, rawPath);
  const isManifest = basename(file) === "package.json";
  const rule = sensitiveRule(file);
  if (!isManifest && !rule && !SOURCE_FILE_RE.test(file)) return [];
  const { before, after } = await contents(call, file, files);

  if (isManifest) {
    const changed = manifestChanges(before, after).map(npmSubject);
    return changed.length ? [{ kind: "dependency-change", via: "manifest", subjects: changed }] : [];
  }
  const actions: GatedAction[] = [];
  const unknown = (await newUnknownImports(file, before, after, files)).map(npmSubject);
  if (unknown.length) {
    actions.push({ kind: "new-external-import", file, subjects: unknown });
  }
  if (rule) actions.push({ kind: "sensitive-file-edit", file, label: rule.label, subjects: sensitiveSubjects(file, before, after, rule) });
  return actions;
}
