// What Claude is told at the start of every session. It never varies, so it never costs the prompt cache.

export const BRIEFING = [
  "Docs-first gate (action-level) is active in this session.",
  "It denies three kinds of tool call until the session holds matching evidence:",
  "1. A dependency change: adding, upgrading or re-pinning a named package with a package manager (pnpm/npm/yarn/bun add or up, npx or dlx of a remote package, pip or uv, brew, cargo add, go get), or adding or changing a dependency's version in package.json. It needs registry evidence for that exact package (`pnpm view <pkg> version`, `pip index versions <pkg>`, `brew info <pkg>`, or reading node_modules/<pkg>/package.json), or docs evidence for its family (the official docs, which cover the packages they document, such as nextjs.org for next and @next/*).",
  "2. A new external import: adding an import of a package the project neither declares nor has installed. It needs the same evidence for that package.",
  "3. A sensitive-file edit: an auth, database schema or migration, billing or webhook, or deployment config file. It needs evidence for a library that file uses.",
  "A denial names each missing package and the lookup that satisfies it. Evidence lasts for the whole session, subagents included, and survives a resume.",
  "Read-only work, agents, plans, prose and scratch files are never gated. `/docs-gate` shows the evidence held. Typing `hook override` turns the gate off for 15 minutes, and only works when the user types it.",
  "Final answers for library, API, auth, schema, billing, or deployment work end with a short Evidence checked section."
].join("\n");

export const OVERRIDE_ACK = "Docs-first gate override accepted; the gate is off for 15 minutes.";
