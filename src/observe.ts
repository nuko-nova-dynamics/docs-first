// What evidence a finished tool call produced.

import { registryLookups, registryPackageFromUrl } from "./ecosystems.ts";
import type { Finding, ToolCall, ToolOutcome } from "./model.ts";
import { commands, head } from "./shell.ts";
import { context7Subjects, docsSubjectsFromUrl, urlsIn, vendorOfMcpTool } from "./sources.ts";

// Output that means the lookup found nothing, even when the tool reported success (curl prints a 404 page and exits 0).
const FAILURE_RE = /\b(E404|ERR_PNPM_FETCH_404|404 Not Found|ENOTFOUND|ECONNREFUSED|command not found|No such file or directory|Could not resolve|Request failed)\b/i;
const FETCH_COMMANDS = new Set(["curl", "wget", "gh", "firecrawl", "ctx7", "http", "xh"]);
const GITHUB_DOCS_TOOL_RE = /github__(get_file_contents|get_latest_release|list_releases|get_release_by_tag|search_code)$/i;

export function looksFailed(text: string): boolean {
  return FAILURE_RE.test(String(text || "").slice(0, 400));
}

function registryFindings(command: string, source: string): Finding[] {
  return registryLookups(command).map((s) => ({ kind: "registry", ecosystem: s.ecosystem, subject: s.name, source }));
}

/** Registry lookups a command line makes before its own changes, so `pnpm view x && pnpm add x` stands on its own. */
export function inlineFindings(command: string): Finding[] {
  return registryFindings(command, "same command");
}

function urlFindings(url: string, source: string): Finding[] {
  const out: Finding[] = docsSubjectsFromUrl(url).map((subject) => ({ kind: "docs", subject, source }));
  const pkg = registryPackageFromUrl(url);
  if (pkg) out.push({ kind: "registry", ecosystem: pkg.ecosystem, subject: pkg.name, source });
  return out;
}

function shellFindings(command: string): Finding[] {
  const out = registryFindings(command, "shell");
  for (const t of commands(command)) {
    const h = head(t);
    if (!FETCH_COMMANDS.has(h)) continue;
    for (const url of t.filter((x) => /^https?:\/\//.test(x))) out.push(...urlFindings(url, h));
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
  // Reading or listing an installed package's own files.
  for (const field of ["file_path", "path", "pattern"]) {
    const m = String(call[field] ?? "").match(/node_modules\/((?:@[^/]+\/)?[^/@]+)/);
    if (m?.[1]) out.push({ kind: "registry", ecosystem: "npm", subject: m[1], source: "installed source" });
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
