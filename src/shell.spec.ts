import assert from "node:assert/strict";
import test from "node:test";
import { commands, splitShell, tokenize } from "./shell.ts";

test("shell splitting respects quotes, chains and substitutions", () => {
  assert.deepEqual(splitShell(`cd app && pnpm add zod; echo "a && b"`), ["cd app", "pnpm add zod", 'echo "a && b"']);
  assert.deepEqual(splitShell(`echo $(pnpm view zod version) | head`), ["pnpm view zod version", "echo", "head"]);
  assert.deepEqual(tokenize(`FOO=1 pnpm --filter web add "zod@3"`), ["pnpm", "--filter", "web", "add", "zod@3"]);
});

test("redirections are not words, and a lone & ends a command", () => {
  assert.deepEqual(tokenize("pnpm add -D typescript@7 2>&1"), ["pnpm", "add", "-D", "typescript@7"]);
  assert.deepEqual(tokenize("pnpm add zod > /dev/null 2> err.log"), ["pnpm", "add", "zod"]);
  assert.deepEqual(tokenize("pnpm add zod &>/dev/null"), ["pnpm", "add", "zod"]);
  assert.deepEqual(splitShell("pnpm add zod & echo done"), ["pnpm add zod", "echo done"]);
  assert.deepEqual(splitShell("pnpm add zod 2>&1 | tail -4"), ["pnpm add zod 2>&1", "tail -4"]);
});

test("substitutions run whether quoted or not, and heredoc bodies are data", () => {
  assert.deepEqual(splitShell(`echo "$(pnpm add zod)"`), ["pnpm add zod", 'echo ""']);
  assert.deepEqual(splitShell("echo `pnpm add zod`"), ["pnpm add zod", "echo"]);
  assert.deepEqual(splitShell("cat <<'EOF'\npnpm add zod\nEOF\ngit status"), ["cat <<'EOF'", "git status"]);
  assert.deepEqual(splitShell("cat <<-EOF > notes.md\n\tpnpm add zod\n\tEOF"), ["cat <<-EOF > notes.md"]);
  assert.deepEqual(splitShell(`echo '$(pnpm add zod)'`), [`echo '$(pnpm add zod)'`], "single quotes keep it literal");
});

test("wrappers are looked through, and only && chains a command to the one before", () => {
  assert.deepEqual(tokenize("env X=1 pnpm add zod"), ["pnpm", "add", "zod"]);
  assert.deepEqual(tokenize("sudo -u me npm i zod"), ["npm", "i", "zod"]);
  assert.deepEqual(commands("a && b || c; d &&\ne").map((s) => s.chained), [false, true, false, false, true]);
});
