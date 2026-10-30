import assert from "node:assert/strict";
import test from "node:test";
import { docsSubjectsFromUrl, vendorOfMcpTool } from "./sources.ts";

test("docs subjects from urls", () => {
  assert.deepEqual(docsSubjectsFromUrl("https://nextjs.org/docs/app/api-reference"), ["nextjs"]);
  assert.deepEqual(docsSubjectsFromUrl("https://docs.stripe.com/webhooks"), ["stripe"], "path segments are not subjects");
  assert.deepEqual(docsSubjectsFromUrl("https://developers.cloudflare.com/workers/"), ["cloudflare"]);
  assert.deepEqual(docsSubjectsFromUrl("https://www.gov.uk/guidance/x"), ["gov"]);
  assert.deepEqual(docsSubjectsFromUrl("https://github.com/colinhacks/zod/releases"), ["zod", "github"]);
  assert.deepEqual(docsSubjectsFromUrl("https://api.github.com/repos/vercel/next.js/releases/latest"), ["next.js", "github"]);
  assert.deepEqual(docsSubjectsFromUrl("https://medium.com/@x/how-to-use-zod"), []);
  assert.deepEqual(docsSubjectsFromUrl("https://example.com/blog/post"), [], "a non-docs page is not evidence");
  assert.deepEqual(docsSubjectsFromUrl("https://code.claude.com/docs/en/hooks.md"), ["claude"]);
});

test("only a vendor's own MCP server counts as that vendor's docs", () => {
  assert.equal(vendorOfMcpTool("mcp__plugin_vercel_vercel__search_vercel_documentation"), "vercel");
  assert.equal(vendorOfMcpTool("mcp__github__get_file_contents"), "github");
  assert.equal(vendorOfMcpTool("mcp__firecrawl__firecrawl_scrape"), "");
});
