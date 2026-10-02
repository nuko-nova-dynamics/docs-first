// What evidence a finished tool call produced, and what a command looks up before its own changes.

import { lookupsIn, registryPackageFromUrl } from "./ecosystems.ts";
import type { Finding, ToolCall, ToolOutcome } from "./model.ts";
import { commands, head, type Step } from "./shell.ts";
import { context7Subjects, docsSubjectsFromUrl, urlsIn, vendorOfMcpTool } from "./sources.ts";

// Output that means the lookup found nothing, even when the tool reported success (curl prints a 404 page and exits 0).
const FAILURE_RE = /\b(E404|ERR_PNPM_FETCH_404|404 Not Found|ENOTFOUND|ECONNREFUSED|command not found|No such file or directory|Could not resolve|Request failed)\b/i;
const FETCH_COMMANDS = new Set(["curl", "wget", "gh", "firecrawl", "ctx7", "http", "xh"]);
const GITHUB_DOCS_TOOL_RE = /github__(get_file_contents|get_latest_release|list_releases|get_release_by_tag|search_code)$/i;
// Tools that only read: a node_modules path in their input means the package's own files were read.
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);
// Flags that make a program print help or its version instead of doing its work.
const HELP_FLAGS = new Set(["-h", "--help", "--version", "-V", "--manual"]);

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
const asksForHelp = (t: readonly string[]) => t.slice(1).some((x) => HELP_FLAGS.has(x));

/** The registry lookups one simple command makes: registry commands, and registry URLs a fetch program requests. */
function registryFindingsOf(t: readonly string[], source: string): Finding[] {
  if (asksForHelp(t)) return [];
  const out: Finding[] = lookupsIn(t).map((s) => ({ kind: "registry", ecosystem: s.ecosystem, subject: s.name, source }));
  if (FETCH_COMMANDS.has(head(t))) {
    for (const url of urlsOf(t)) {
      const pkg = registryPackageFromUrl(url);
      if (pkg) out.push({ kind: "registry", ecosystem: pkg.ecosystem, subject: pkg.name, source });
    }
  }
  return out;
}

/**
 * The registry lookups a command line makes before its change at step `k`, credited only when the shell
 * runs that change because the lookup succeeded: each step from the lookup to the change joined by `&&`,
 * none of them inside a substitution. `pnpm view x && pnpm add x` stands on its own; `pnpm add x && pnpm
 * view x`, `pnpm view x || pnpm add x` and `echo "$(pnpm view x)" && pnpm add x` do not.
 */
export function inlineEvidence(steps: readonly Step[], k: number): Finding[] {
  const out: Finding[] = [];
  if (steps[k]?.nested) return out;
  for (let j = k - 1; j >= 0; j -= 1) {
    if (!steps.slice(j + 1, k + 1).every((s) => s.chained && !s.nested)) break;
    const step = steps[j];
    if (step && !step.nested) out.push(...registryFindingsOf(step.tokens, "same command"));
  }
  return out;
}

function shellFindings(command: string): Finding[] {
  const out: Finding[] = [];
  for (const { tokens: t } of commands(command)) {
    out.push(...registryFindingsOf(t, "shell"));
    const h = head(t);
    if (!FETCH_COMMANDS.has(h) || asksForHelp(t)) continue;
    for (const url of urlsOf(t)) out.push(...docsSubjectsFromUrl(url).map((subject): Finding => ({ kind: "docs", subject, source: h })));
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
