import assert from "node:assert/strict";
import test from "node:test";
import type { Finding, ToolCall, ToolOutcome } from "./model.ts";
import { observe } from "./observe.ts";

const ok = (text = "ok"): ToolOutcome => ({ succeeded: true, text });
const seen = (call: ToolCall, outcome: ToolOutcome = ok()) =>
  observe(call, outcome).map((f: Finding) => (f.kind === "registry" ? `registry:${f.ecosystem}:${f.subject}` : `docs:${f.subject}`));

test("evidence from finished tool calls", () => {
  assert.deepEqual(seen({ tool: "Bash", command: "pnpm view zod version" }, ok("3.24.0")), ["registry:npm:zod"]);
  assert.deepEqual(seen({ tool: "Bash", command: "curl -s https://registry.npmjs.org/zod" }), ["registry:npm:zod"]);
  assert.deepEqual(seen({ tool: "Bash", command: "gh api repos/vercel/next.js/releases/latest" }), ["docs:next.js", "docs:github"]);
  assert.deepEqual(seen({ tool: "mcp__context7__query-docs", libraryId: "/vercel/next.js", query: "x" }), ["docs:next.js"]);
  assert.deepEqual(seen({ tool: "mcp__context7__query-docs", libraryId: "/prisma/docs/v6.0.0", query: "x" }), ["docs:prisma"]);
  assert.deepEqual(seen({ tool: "Read", file_path: "/p/node_modules/@prisma/client/package.json" }), ["registry:npm:@prisma/client"]);
  assert.deepEqual(seen({ tool: "WebFetch", url: "https://docs.stripe.com/webhooks", prompt: "x" }), ["docs:stripe"]);
  assert.deepEqual(seen({ tool: "mcp__firecrawl__firecrawl_scrape", url: "https://nextjs.org/docs/app" }), ["docs:nextjs"]);
  assert.deepEqual(seen({ tool: "mcp__plugin_vercel_vercel__search_vercel_documentation", topic: "x" }), ["docs:vercel"]);
});

test("failed, refused and not-found lookups produce no evidence", () => {
  assert.deepEqual(seen({ tool: "Bash", command: "pnpm view nope version" }, { succeeded: false, text: "Exit code 1" }), []);
  assert.deepEqual(seen({ tool: "Bash", command: "pnpm view nope version" }, ok("ERR_PNPM_FETCH_404 not found")), []);
  assert.deepEqual(seen({ tool: "WebFetch", url: "https://docs.stripe.com/nope", prompt: "x" }, ok("404 Not Found")), []);
});

test("reading ordinary files and searching the web are not evidence", () => {
  assert.deepEqual(seen({ tool: "Read", file_path: "/p/transcripts/money/23-payment-plans.md" }), []);
  assert.deepEqual(seen({ tool: "WebSearch", query: "zod v4" }), []);
  assert.deepEqual(seen({ tool: "Bash", command: "ls src && git status" }), []);
});
