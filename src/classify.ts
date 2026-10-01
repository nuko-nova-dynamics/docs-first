// Which tool calls are gated actions, and which subjects each one depends on.

import { dependencyChanges } from "./ecosystems.ts";
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

export function importSpecs(source: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(IMPORT_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(source || "")))) if (m[1]) out.add(m[1]);
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

function parseJsonLenient(text: string | null): Record<string, any> | null {
  if (text == null) return null;
  try {
    return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

/** What a project declares, found by walking up from a file. */
export type Knowledge = { declared: Set<string>; aliases: string[]; nodeModulesDirs: string[] };

/**
 * Walks up from the file's directory collecting declared dependencies, `imports` and tsconfig path
 * aliases, and node_modules folders. Null when no package.json lies above: the file is a scratch file
 * and the gate cannot judge its imports.
 */
export async function projectKnowledge(file: string, files: ProjectFiles, rootLimit = 8): Promise<Knowledge | null> {
  let dir = dirname(file);
  let sawPackageJson = false;
  const declared = new Set<string>();
  const aliases: string[] = [];
  const nodeModulesDirs: string[] = [];
  for (let i = 0; i < rootLimit; i += 1) {
    const pkg = parseJsonLenient(await files.read(join(dir, "package.json")));
    if (pkg) {
      sawPackageJson = true;
      for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(pkg[key] || {})) declared.add(name);
      }
      if (pkg.imports) aliases.push(...Object.keys(pkg.imports));
    }
    const tsconfig = parseJsonLenient(await files.read(join(dir, "tsconfig.json")));
    if (tsconfig?.compilerOptions?.paths) aliases.push(...Object.keys(tsconfig.compilerOptions.paths).map((k) => k.replace(/\*$/, "")));
    if (await files.exists(join(dir, "node_modules"))) nodeModulesDirs.push(join(dir, "node_modules"));
    const atRoot = (await files.exists(join(dir, ".git"))) || (await files.exists(join(dir, "pnpm-workspace.yaml")));
    const parent = dirname(dir);
    if (parent === dir || (atRoot && sawPackageJson)) break;
    dir = parent;
  }
  return sawPackageJson ? { declared, aliases, nodeModulesDirs } : null;
}

async function isKnownPackage(pkg: string, spec: string, knowledge: Knowledge, files: ProjectFiles): Promise<boolean> {
  if (knowledge.declared.has(pkg)) return true;
  if (knowledge.aliases.some((a) => spec.startsWith(a))) return true;
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

// Keys whose string values look like versions but are not dependencies.
const MANIFEST_NON_DEP_KEYS = new Set(["name", "version", "type", "main", "types", "module", "license", "author", "description", "packageManager", "private", "node", "pnpm", "npm", "yarn", "bun", "engines", "browser", "homepage", "repository"]);
const DEP_PAIR_RE = /"((?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)"\s*:\s*"((?:[\^~>=<]|\d|npm:|latest|next|canary|beta|rc)[^"]*)"/g;

function dependencyPairs(text: string): Map<string, string> {
  const pairs = new Map<string, string>();
  const re = new RegExp(DEP_PAIR_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || "")))) {
    const [, name, spec] = m;
    if (name && spec && !MANIFEST_NON_DEP_KEYS.has(name)) pairs.set(name, spec);
  }
  return pairs;
}

/** Dependencies this package.json edit adds or re-pins: a new name, or a known name with a different version. */
export function manifestChanges(before: string, after: string): string[] {
  const was = dependencyPairs(before);
  return [...dependencyPairs(after)].filter(([name, spec]) => was.get(name) !== spec).map(([name]) => name);
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
  const before = call.tool === "Edit" ? String(call.old_string ?? "") : ((await files.read(file)) ?? "");
  const after = call.tool === "Edit" ? String(call.new_string ?? "") : String(call.content ?? "");

  if (basename(file) === "package.json") {
    const changed = manifestChanges(before, after).map(npmSubject);
    return changed.length ? [{ kind: "dependency-change", via: "manifest", subjects: changed }] : [];
  }
  const actions: GatedAction[] = [];
  const unknown = (await newUnknownImports(file, before, after, files)).map(npmSubject);
  if (unknown.length) {
    actions.push({ kind: "new-external-import", file, subjects: unknown });
  }
  const rule = sensitiveRule(file);
  if (rule) actions.push({ kind: "sensitive-file-edit", file, label: rule.label, subjects: sensitiveSubjects(file, before, after, rule) });
  return actions;
}
