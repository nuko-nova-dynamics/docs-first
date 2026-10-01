import assert from "node:assert/strict";
import test from "node:test";
import { classify, importSpecs, manifestChanges, newUnknownImports, sensitiveRule, sensitiveSubjects, specToPackage } from "./classify.ts";
import { fakeFiles, imp, q } from "./spec-support.ts";

const PROJECT = {
  "/p/package.json": JSON.stringify({ dependencies: { react: "^19" }, devDependencies: { vitest: "^3" } }),
  "/p/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@ui/*": ["./ui/*"] } } }),
  "/p/node_modules/lodash-es/package.json": "{}",
  "/p/.git/HEAD": "ref: refs/heads/main"
};

test("import extraction and package resolution", () => {
  const src = [
    `import { z } from ${q("zod")};`,
    `import type { X } from ${q("@scope/pkg/sub")};`,
    `import ${q("./styles.css")};`,
    `const fs = require(${q("node:fs")});`,
    `export * from ${q("next/navigation")};`,
    `const m = await import(${q("lodash-es")});`
  ].join("\n");
  assert.deepEqual(importSpecs(src), ["zod", "@scope/pkg/sub", "./styles.css", "node:fs", "next/navigation", "lodash-es"]);
  assert.equal(specToPackage("@scope/pkg/sub"), "@scope/pkg");
  assert.equal(specToPackage("next/navigation"), "next");
  assert.equal(specToPackage("./x"), "");
  assert.equal(specToPackage("@/lib/x"), "");
  assert.equal(specToPackage("node:fs"), "");
  assert.equal(specToPackage("fs"), "");
  assert.equal(specToPackage("claude-code"), "", "the mod API is provided by Claude Code");
  assert.equal(specToPackage("astro:content"), "", "runtime scheme specifiers are not packages");
  assert.equal(specToPackage("npm:zod"), "zod");
});

test("strings and property names that contain the word are not imports", () => {
  const word = "im" + "port";
  assert.deepEqual(importSpecs(`actions.push({ kind: "new-external-${word}", file, subjects: x.map((n) => ({ name, ecosystem: "npm" })) });`), []);
  assert.deepEqual(importSpecs(`{ "exports": { "${word}": "./x.js", "require": "./y.cjs" } }`), []);
  assert.deepEqual(importSpecs(`loader.${word}("zod")`), []);
});

test("new unknown imports use project knowledge", async () => {
  const files = fakeFiles(PROJECT);
  const added = [imp("react"), imp("lodash-es"), imp("@ui/button"), imp("zod")].join("\n");
  assert.deepEqual(await newUnknownImports("/p/src/a.tsx", "", added, files), ["zod"]);
  assert.deepEqual(await newUnknownImports("/p/src/a.tsx", imp("zod"), `${imp("zod")}\nconst x = 1;`, files), [], "a pre-existing import is not new");
  assert.deepEqual(await newUnknownImports("/p/notes.md", "", imp("zod"), files), [], "non-source files are ignored");
  assert.deepEqual(await newUnknownImports("/scratch/x.mjs", "", imp("zod"), files), [], "no package.json above: cannot judge, so not gated");
});

test("package.json: added and re-pinned dependencies are changes, other keys are not", () => {
  const before = `{ "name": "app", "version": "1.0.0", "dependencies": { "react": "^19.0.0", "next": "^15.0.0", "@app/ui": "workspace:*" } }`;
  const after = `{ "name": "app", "version": "1.1.0", "dependencies": { "react": "^19.0.0", "next": "^16.0.0", "zod": "^3.24.0", "@tanstack/react-query": "5.0.0", "@app/ui": "workspace:^" }, "packageManager": "pnpm@10.0.0", "engines": { "node": ">=22" } }`;
  assert.deepEqual(manifestChanges(before, after), ["next", "zod", "@tanstack/react-query"]);
  assert.deepEqual(manifestChanges(`"next": "^15.0.0"`, `"next": "^16.0.0"`), ["next"], "an Edit fragment that bumps one version");
});

test("sensitive files and their subjects", () => {
  assert.equal(sensitiveRule("/p/prisma/schema.prisma")?.label, "database schema or migration");
  assert.equal(sensitiveRule("/p/src/middleware.ts")?.label, "auth or request middleware");
  assert.equal(sensitiveRule("/p/lib/oauth.ts")?.label, "auth or request middleware");
  assert.equal(sensitiveRule("/p/lib/author.ts"), null);
  assert.equal(sensitiveRule("/p/app/api/stripe/webhook/route.ts")?.label, "billing or webhook handler");
  assert.equal(sensitiveRule("/p/.github/workflows/ci.yml")?.label, "deployment or CI config");
  assert.equal(sensitiveRule("/p/vercel.json")?.label, "deployment or CI config");
  assert.equal(sensitiveRule("/p/src/components/Button.tsx"), null);
  assert.equal(sensitiveRule("/Users/x/Downloads/email-draft.md"), null);
  const middleware = sensitiveRule("/p/src/middleware.ts")!;
  const clerk = `import { clerkMiddleware } from ${q("@clerk/nextjs/server")};`;
  assert.deepEqual(sensitiveSubjects("/p/src/middleware.ts", clerk, "", middleware).map((s) => s.name), ["@clerk/nextjs"]);
  const webhook = "/p/app/api/stripe/webhook/route.ts";
  assert.deepEqual(sensitiveSubjects(webhook, "", "", sensitiveRule(webhook)!).map((s) => s.name), ["stripe"], "vendors the path names");
});

test("classify: which tool calls are gated actions", async () => {
  const files = fakeFiles({ ...PROJECT, "/p/src/existing.ts": imp("zod") });
  const zod = [{ name: "zod", ecosystem: "npm" }];
  assert.deepEqual(await classify({ tool: "Bash", command: "pnpm add zod" }, files, "/p"), [{ kind: "dependency-change", via: "command", subjects: zod }]);
  assert.deepEqual(await classify({ tool: "Write", file_path: "/p/src/existing.ts", content: `${imp("zod")}\nexport {};` }, files, "/p"), [], "Write compares against the file on disk");
  const relative = await classify({ tool: "Edit", file_path: "src/b.ts", old_string: "", new_string: imp("zod") }, files, "/p");
  assert.equal(relative[0]?.kind, "new-external-" + "import");
  assert.equal(relative[0]?.file, "/p/src/b.ts", "a relative path resolves against the working directory");
  assert.deepEqual(relative[0]?.subjects, zod);
  const bump = { tool: "Edit", file_path: "/p/package.json", old_string: `"next": "^15.0.0"`, new_string: `"next": "^16.0.0"` };
  assert.deepEqual(await classify(bump, files, "/p"), [{ kind: "dependency-change", via: "manifest", subjects: [{ name: "next", ecosystem: "npm" }] }]);
  for (const call of [{ tool: "Read", file_path: "/p/package.json" }, { tool: "Agent", prompt: "add zod" }, { tool: "ExitPlanMode" }]) {
    assert.deepEqual(await classify(call, files, "/p"), [], call.tool);
  }
});
