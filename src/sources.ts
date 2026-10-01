// Which sources count as docs evidence, and which family of packages each one vouches for.

const SECONDARY_HOST_RE = /(^|\.)(medium\.com|dev\.to|stackoverflow\.com|stackexchange\.com|reddit\.com|news\.ycombinator\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|wikipedia\.org|substack\.com|quora\.com|linkedin\.com)$/i;
const DOCS_HOST_PREFIX_RE = /^(docs?|developers?|api|apis|platform|learn|help|support|reference|devcenter|kb)\./i;
const DOCS_PATH_RE = /\/(docs?|documentation|reference|references|guides?|api|apis|learn|releases?|changelog|blob|tree|llms\.txt|manual|spec|specs)(\/|$|\.)/i;
const GOVERNMENT_RE = /(^|\.)(gov|edu|mil)(\.[a-z]{2})?$|(^|\.)europa\.eu$/;

/**
 * The families a docs URL vouches for: the site's own name for an official docs page
 * (docs.stripe.com → stripe, nextjs.org/docs → nextjs), or the repository for GitHub.
 * Blogs, forums and other secondary hosts vouch for nothing.
 */
export function docsSubjectsFromUrl(url: string): string[] {
  let u: URL;
  try { u = new URL(url); } catch { return []; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (SECONDARY_HOST_RE.test(host)) return [];
  const segs = u.pathname.split("/").filter(Boolean);
  if (host === "github.com" || host === "raw.githubusercontent.com" || host === "api.github.com") {
    const repoIdx = host === "api.github.com" ? (segs[0] === "repos" ? 2 : -1) : 1;
    return repoIdx > 0 && segs[repoIdx] ? [segs[repoIdx], "github"] : [];
  }
  const official = DOCS_HOST_PREFIX_RE.test(host) || DOCS_PATH_RE.test(u.pathname) || GOVERNMENT_RE.test(host) || u.pathname.endsWith("llms.txt");
  if (!official) return [];
  // The registrable label: docs.stripe.com → stripe, gov.uk-style suffixes handled.
  const labels = host.split(".");
  const suffixLike = labels.length >= 3 && /^(co|com|org|net|gov|ac|edu)$/.test(labels[labels.length - 2] ?? "") && (labels[labels.length - 1] ?? "").length === 2;
  const core = labels[labels.length - (suffixLike ? 3 : 2)] || labels[0];
  return core ? [core] : [];
}

/** Every http(s) URL in a piece of text. */
export function urlsIn(text: string): string[] {
  return String(text || "").match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
}

// Context7 ids are /<owner>/<project>[/<version>]; a project named like these says nothing about the library.
const GENERIC_PROJECT = new Set(["docs", "doc", "documentation", "website", "site", "www", "llms", "llmstxt"]);

/** The families a Context7 call is about: the library name it resolves, or the project in a library id. */
export function context7Subjects(input: { readonly [field: string]: unknown }): string[] {
  const out: string[] = [];
  if (typeof input.libraryName === "string" && input.libraryName.trim()) out.push(input.libraryName.trim());
  if (typeof input.libraryId === "string") {
    const segs = input.libraryId.split("/").filter(Boolean);
    if (/^v?\d/.test(segs[segs.length - 1] ?? "")) segs.pop();
    const project = segs[1] || "";
    if (project && !GENERIC_PROJECT.has(project.toLowerCase())) out.push(project);
    else if (segs[0]) out.push(segs[0]);
  }
  return out;
}

// Vendors whose own MCP servers are primary sources for their platform.
const VENDOR_MCPS = new Set(["vercel", "github", "stripe", "sentry", "supabase", "expo", "railway", "cloudflare", "revenuecat", "resend", "elevenlabs", "convex", "posthog", "twilio", "firebase", "neon", "planetscale", "upstash"]);

/**
 * The vendor an MCP tool belongs to when that vendor runs it: `mcp__plugin_vercel_vercel__x` → vercel,
 * `mcp__github__x` → github. "" for a server that is not a known vendor's own.
 */
export function vendorOfMcpTool(tool: string): string {
  const m = tool.match(/^mcp__(?:plugin_)?([a-z0-9]+)_/i);
  const vendor = m?.[1]?.toLowerCase() ?? "";
  return VENDOR_MCPS.has(vendor) ? vendor : "";
}
