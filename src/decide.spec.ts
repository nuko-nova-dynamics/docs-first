import assert from "node:assert/strict";
import test from "node:test";
import { classify } from "./classify.ts";
import { decide } from "./decide.ts";
import type { Finding, ToolCall, Verdict } from "./model.ts";
import { fakeFiles, imp, q } from "./spec-support.ts";

const files = fakeFiles({
  "/p/package.json": JSON.stringify({ dependencies: { react: "^19" } }),
  "/p/.git/HEAD": "ref: refs/heads/main"
});
const registry = (subject: string): Finding => ({ kind: "registry", ecosystem: "npm", subject, source: "test" });
const docs = (subject: string): Finding => ({ kind: "docs", subject, source: "test" });
const verdict = async (call: ToolCall, evidence: Finding[] = []) => decide(await classify(call, files, "/p"), evidence, "/p");
const reason = (v: Verdict) => (v.allow ? "" : v.reason);
const ALLOW = { allow: true };

test("a dependency change is denied until evidence covers it, and the denial names the lookup", async () => {
  const add = { tool: "Bash", command: "pnpm add zod" };
  const denied = await verdict(add);
  assert.match(reason(denied), /adds, upgrades or installs zod/);
  assert.match(reason(denied), /`pnpm view zod version`/);
  assert.deepEqual(await verdict(add, [registry("zod")]), ALLOW);
  assert.deepEqual(await verdict({ tool: "Bash", command: "pnpm add @next/font" }, [docs("nextjs")]), ALLOW, "docs cover their family");
  assert.match(reason(await verdict({ tool: "Bash", command: "pip install requests" })), /`pip index versions requests`/);
  assert.deepEqual(await verdict({ tool: "Bash", command: "pnpm install" }), ALLOW);
});

test("evidence for one package does not cover another whose name contains it", async () => {
  assert.match(reason(await verdict({ tool: "Bash", command: "pnpm add react-native-svg" }, [registry("react"), docs("react")])), /react-native-svg/);
});

test("a command that looks a package up before adding it stands on its own", async () => {
  assert.deepEqual(await verdict({ tool: "Bash", command: "pnpm view react version && pnpm add react" }), ALLOW);
  assert.deepEqual(await verdict({ tool: "Bash", command: "curl -fsSL https://registry.npmjs.org/zod && pnpm add zod" }), ALLOW);
  assert.deepEqual(await verdict({ tool: "Bash", command: "pnpm view zod version &&\n# then add it\npnpm add zod" }), ALLOW, "a comment line keeps the chain");
  assert.deepEqual(await verdict({ tool: "Bash", command: "pnpm view zod version && pnpm add zod && pnpm view react version && pnpm add react" }), ALLOW, "each change has its own lookup before it");
});

test("a lookup after the change, or instead of it, does not count", async () => {
  for (const command of [
    "pnpm add zod && pnpm view zod version",
    "pnpm view zod version || pnpm add zod",
    "pnpm view zod version; pnpm add zod",
    'true && echo "$(pnpm view zod version)" && pnpm add zod',
    "curl --help https://registry.npmjs.org/zod && pnpm add zod",
    "command -v pnpm view zod version && pnpm add zod"
  ]) {
    assert.match(reason(await verdict({ tool: "Bash", command })), /zod/, command);
  }
});

test("re-pinning a dependency in package.json needs evidence for it", async () => {
  const bump = { tool: "Edit", file_path: "/p/package.json", old_string: `"next": "^15.0.0"`, new_string: `"next": "^16.0.0"` };
  assert.match(reason(await verdict(bump)), /re-pins next in package.json/);
  assert.deepEqual(await verdict(bump, [registry("next")]), ALLOW);
});

test("new external imports and sensitive files", async () => {
  const write = { tool: "Write", file_path: "/p/src/a.tsx", content: `import { z } from ${q("zod")};` };
  assert.match(reason(await verdict(write)), /imports zod/);
  assert.deepEqual(await verdict(write, [docs("zod")]), ALLOW);

  const clerk = `import { clerkMiddleware } from ${q("@clerk/nextjs/server")};`;
  const middleware = { tool: "Edit", file_path: "/p/src/middleware.ts", old_string: clerk, new_string: `${clerk}\n// change` };
  const denied = reason(await verdict(middleware));
  assert.match(denied, /src\/middleware\.ts is a sensitive file \(auth or request middleware\)/);
  assert.match(denied, /@clerk\/nextjs/);
  assert.deepEqual(await verdict(middleware, [docs("clerk")]), ALLOW);
  assert.deepEqual(await verdict({ tool: "Edit", file_path: "/p/src/middleware.ts", old_string: "a", new_string: "b" }, [docs("clerk")]), ALLOW, "with no library to name, any evidence will do");

  const migration = { tool: "Write", file_path: "/p/migrations/0001_init.sql", content: "create table x();" };
  assert.match(reason(await verdict(migration)), /consulted no docs or registry data/);
  assert.deepEqual(await verdict(migration, [docs("postgres")]), ALLOW);
});

test("agents, reads, prose and unrelated edits are never gated", async () => {
  for (const call of [
    { tool: "Agent", prompt: "Profile three client repos", subagent_type: "Explore" },
    { tool: "Bash", command: "git commit -m x && git push" },
    { tool: "Write", file_path: "/tmp/report.md", content: `# Findings\n${imp("zod")}` },
    { tool: "Edit", file_path: "/Users/x/Downloads/email.txt", old_string: "a", new_string: "b" },
    { tool: "ExitPlanMode" }
  ]) {
    assert.deepEqual(await verdict(call), ALLOW, call.tool);
  }
});

test("a denial carries one short line for a person beside the reason for Claude", async () => {
  const summary = (v: Verdict) => (v.allow ? "" : v.summary);
  assert.equal(summary(await verdict({ tool: "Bash", command: "pnpm add zod" })), "changing zod: needs registry or docs evidence");
  assert.equal(
    summary(await verdict({ tool: "Bash", command: "pnpm add zod && pnpm add valibot" })),
    "changing zod: needs registry or docs evidence; changing valibot: needs registry or docs evidence"
  );
  assert.equal(summary(await verdict({ tool: "Bash", command: "pnpm up zod" })), "changing zod: needs registry or docs evidence", "an upgrade is not called an addition");
});
