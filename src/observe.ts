// What evidence a finished tool call produced.

import { changesIn, lookupsIn, registryLookups, registryPackageFromUrl } from "./ecosystems.ts";
import type { Finding, ToolCall, ToolOutcome } from "./model.ts";
import { commands, head } from "./shell.ts";
import { context7Subjects, docsSubjectsFromUrl, urlsIn, vendorOfMcpTool } from "./sources.ts";

// Output that means the lookup found nothing, even when the tool reported success (curl prints a 404 page and exits 0).
const FAILURE_RE = /\b(E404|ERR_PNPM_FETCH_404|404 Not Found|ENOTFOUND|ECONNREFUSED|command not found|No such file or directory|Could not resolve|Request failed)\b/i;
const FETCH_COMMANDS = new Set(["curl", "wget", "gh", "firecrawl", "ctx7", "http", "xh"]);
const GITHUB_DOCS_TOOL_RE = /github__(get_file_contents|get_latest_release|list_releases|get_release_by_tag|search_code)$/i;
// Tools that only read: a node_modules path in their input means the package's own files were read.
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);

export function looksFailed(text: string): boolean {
  return FAILURE_RE.test(String(text || "").slice(0, 400));
}

function urlFindings(url: string, source: string): Finding[] {
  const out: Finding[] = docsSubjectsFromUrl(url).map((subject) => ({ kind: "docs", subject, source }));
  const pkg = registryPackageFromUrl(url);
  if (pkg) out.push({ kind: "registry", ecosystem: pkg.ecosystem, subject: pkg.name, source });
  return out;
}

const urlsOf = (t: readonly string[]) => t.filter((x) => /^https?:\/\//.test(x));

/**
 * Registry lookups a command line makes before its own dependency changes, credited only when the
 * shell runs the change after the lookup succeeded: `pnpm view x && pnpm add x` stands on its own,
 * while `pnpm add x && pnpm view x` and `pnpm view x || pnpm add x` do not.
 */
export function inlineFindings(command: string): Finding[] {
  const steps = commands(command);
  const changing = steps.flatMap((s, i) => (changesIn(s.tokens).length ? [i] : []));
  if (!changing.length) return [];
  const first = Math.min(...changing);
  const last = Math.max(...changing);
  const out: Finding[] = [];
  for (let j = 0; j < first; j += 1) {
    if (!steps.slice(j + 1, last + 1).every((s) => s.chained)) continue;
    const tokens = steps[j]?.tokens ?? [];
    for (const s of lookupsIn(tokens)) out.push({ kind: "registry", ecosystem: s.ecosystem, subject: s.name, source: "same command" });
    if (!FETCH_COMMANDS.has(head(tokens))) continue;
    for (const url of urlsOf(tokens)) {
      const pkg = registryPackageFromUrl(url);
      if (pkg) out.push({ kind: "registry", ecosystem: pkg.ecosystem, subject: pkg.name, source: "same command" });
    }
  }
  return out;
}

function shellFindings(command: string): Finding[] {
  const out: Finding[] = registryLookups(command).map((s) => ({ kind: "registry", ecosystem: s.ecosystem, subject: s.name, source: "shell" }));
  for (const { tokens: t } of commands(command)) {
    const h = head(t);
    if (!FETCH_COMMANDS.has(h)) continue;
    for (const url of urlsOf(t)) out.push(...urlFindings(url, h));
    if (h === "gh" && t[1] === "api" && t[2]) {
      const m = t[2].match(/^\/?repos\/[^/]+\/([^/]+)/);
      if (m?.[1]) out.push({ kind: "docs", subject: m[1], source: "gh api" }, { kind: "docs", subject: "github", source: "gh api" });
    }
  }
  return out;
}

function toolFindings(call: ToolCall): Finding[] {
  const tool = String(call.tool);
  const out: Finding[] = [];
  if (READ_TOOLS.has(tool)) {
    for (const field of ["file_path", "path", "pattern"]) {
      const m = String(call[field] ?? "").match(/node_modules\/((?:@[^/]+\/)?[^/@]+)/);
      if (m?.[1]) out.push({ kind: "registry", ecosystem: "npm", subject: m[1], source: "installed source" });
    }
  }
  const isMcp = tool.startsWith("mcp__");
  if (tool === "WebFetch" || isMcp) {
    const urls = [call.url, call.urls].flat().filter((x): x is string => typeof x === "string");
    for (const url of urlsIn(urls.join(" "))) out.push(...urlFindings(url, tool));
  }
  if (isMcp) {
    if (/context7/i.test(tool)) out.push(...context7Subjects(call).map((subject): Finding => ({ kind: "docs", subject, source: "context7" })));
    const vendor = vendorOfMcpTool(tool);
    if (vendor) out.push({ kind: "docs", subject: vendor, source: tool });
    if (GITHUB_DOCS_TOOL_RE.test(tool) && typeof call.repo === "string") out.push({ kind: "docs", subject: call.repo, source: tool });
  }
  return out;
}

/** The evidence a tool call produced. A call that failed, was refused, or came back with a not-found page produces none. */
export function observe(call: ToolCall, outcome: ToolOutcome): Finding[] {
  if (!outcome.succeeded || looksFailed(outcome.text)) return [];
  return call.tool === "Bash" ? shellFindings(String(call.command ?? "")) : toolFindings(call);
}
