import assert from "node:assert/strict";
import test from "node:test";
import { dependencyChanges, registryLookups, registryPackageFromUrl, remedyFor } from "./ecosystems.ts";

const names = (command: string) => dependencyChanges(command).map((s) => s.name);
const lookups = (command: string) => registryLookups(command).map((s) => `${s.ecosystem}:${s.name}`);

test("dependency changes: js package managers", () => {
  assert.deepEqual(names("pnpm add zod @tanstack/react-query@5 -D"), ["zod", "@tanstack/react-query"]);
  assert.deepEqual(names("pnpm --filter web add zod --filter api"), ["zod"]);
  assert.deepEqual(names("npm i react@19 react-dom"), ["react", "react-dom"]);
  assert.deepEqual(names("bun add -d vitest"), ["vitest"]);
  assert.deepEqual(names("pnpm up next"), ["next"]);
  assert.deepEqual(names("yarn add file:../local github:user/repo"), []);
  assert.deepEqual(names("pnpm install"), [], "a lockfile install names nothing");
  assert.deepEqual(names("pnpm install --frozen-lockfile"), []);
  assert.deepEqual(names("pnpm up --latest"), [], "a bare upgrade names nothing");
});

test("dependency changes: scaffolders, fetch-and-run, and other ecosystems", () => {
  assert.deepEqual(names("npx create-next-app@latest my-app"), ["create-next-app"]);
  assert.deepEqual(names("pnpm dlx shadcn@latest init"), ["shadcn"]);
  assert.deepEqual(names("pnpm create next-app my-app"), ["create-next-app"]);
  assert.deepEqual(names("bunx --bun create-expo-app x"), ["create-expo-app"]);
  assert.deepEqual(names("npx playwright --version"), [], "installed binary, version check");
  assert.deepEqual(names("npx playwright test"), [], "installed binary");
  assert.deepEqual(names("npx playwright@1.50 test"), ["playwright"], "a pinned spec is a fetch");
  assert.deepEqual(names("npx -y some-tool"), ["some-tool"]);
  assert.deepEqual(names("npx -p cowsay cowsay hi"), ["cowsay"]);
  assert.deepEqual(names("pnpm --package=typescript@7 dlx tsc -p ."), ["typescript"], "--package names what is fetched, not the binary run");
  assert.deepEqual(names("pnpm dlx --package typescript tsc"), ["typescript"]);
  assert.deepEqual(names("npx tsc -p tsconfig.json --noEmit"), [], "-p after the program is the program's own flag");
  assert.deepEqual(names("npx -p typescript tsc --noEmit"), ["typescript"]);
  assert.deepEqual(names("yarn dlx -p typescript tsc -p tsconfig.json"), ["typescript"]);
  assert.deepEqual(names("pnpm add -g $spec"), [], "a shell variable is not a package name");
  assert.deepEqual(names("npx @scope/create-thing"), ["@scope/create-thing"]);
  assert.deepEqual(dependencyChanges("pip install requests>=2 pillow"), [{ name: "requests", ecosystem: "python" }, { name: "pillow", ecosystem: "python" }]);
  assert.deepEqual(names("uv add httpx"), ["httpx"]);
  assert.deepEqual(names("pip install -r requirements.txt"), []);
  assert.deepEqual(dependencyChanges("brew install homebrew/cask/ghostty"), [{ name: "ghostty", ecosystem: "brew" }]);
  assert.deepEqual(names("cargo add serde@1 tokio"), ["serde", "tokio"]);
  assert.deepEqual(dependencyChanges("go get go.uber.org/zap@v1.27.0"), [{ name: "go.uber.org/zap", ecosystem: "go" }]);
});

test("read-only and unrelated commands change no dependencies", () => {
  for (const cmd of ["pnpm view zod version", "pnpm test", "git status", "ls node_modules", "grep install README.md", "pnpm exec tsc --noEmit", "node script.mjs", "pnpm run build", "brew info ghostty"]) {
    assert.deepEqual(names(cmd), [], cmd);
  }
});

test("registry lookups from commands and registry urls", () => {
  assert.deepEqual(lookups("pnpm view zod version"), ["npm:zod"]);
  assert.deepEqual(lookups("npm info @scope/pkg dist-tags --json"), ["npm:@scope/pkg"]);
  assert.deepEqual(lookups("cat node_modules/next/package.json"), ["npm:next"]);
  assert.deepEqual(lookups("pip index versions requests && brew info ghostty"), ["python:requests", "brew:ghostty"]);
  assert.deepEqual(registryPackageFromUrl("https://registry.npmjs.org/%40prisma%2Fclient"), { name: "@prisma/client", ecosystem: "npm" });
  assert.deepEqual(registryPackageFromUrl("https://www.npmjs.com/package/zod"), { name: "zod", ecosystem: "npm" });
  assert.deepEqual(registryPackageFromUrl("https://pypi.org/pypi/requests/json"), { name: "requests", ecosystem: "python" });
  assert.equal(registryPackageFromUrl("https://example.com/x"), null);
});

test("each ecosystem names its own lookup as the remedy", () => {
  assert.equal(remedyFor({ name: "zod", ecosystem: "npm" }), "pnpm view zod version");
  assert.equal(remedyFor({ name: "requests", ecosystem: "python" }), "pip index versions requests");
  assert.equal(remedyFor({ name: "ghostty", ecosystem: "brew" }), "brew info ghostty");
  assert.equal(remedyFor({ name: "serde", ecosystem: "cargo" }), "cargo info serde");
  assert.equal(remedyFor({ name: "go.uber.org/zap", ecosystem: "go" }), "go list -m -versions go.uber.org/zap");
});

test("each package manager's own flags decide what is a package", () => {
  assert.deepEqual(names("pnpm add -w zod"), ["zod"], "pnpm -w is a switch");
  assert.deepEqual(names("npm i -w web zod"), ["zod"], "npm -w names a workspace");
  assert.deepEqual(names("yarn workspace web add zod"), ["zod"]);
  assert.deepEqual(names("cargo add serde --features derive"), ["serde"]);
  assert.deepEqual(names("pnpm add compat-zod@npm:zod@3"), ["zod"], "an alias fetches its target");
});

test("a lookup is the view subcommand itself, or a file reader under node_modules", () => {
  assert.deepEqual(lookups("pnpm exec echo view zod"), []);
  assert.deepEqual(lookups("yarn npm info zod"), ["npm:zod"]);
  assert.deepEqual(lookups("echo hi > node_modules/zod/README.md"), []);
  assert.deepEqual(lookups("rm -rf node_modules/zod"), []);
});

test("flag values are not packages: bun --filter, cargo --registry; yarn workspace commands are read through", () => {
  assert.deepEqual(names("bun add zod --filter api"), ["zod"]);
  assert.deepEqual(lookups("cargo info rand --registry serde"), ["cargo:rand"]);
  assert.deepEqual(lookups("yarn workspace web npm info zod"), ["npm:zod"]);
});
