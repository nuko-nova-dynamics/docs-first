// Runs under `claude plugin test .`: the mod loaded by Claude Code's own host, with the engine stubbed beneath it.

import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

/** The world beneath the mod: an in-memory store and clock, and tools that succeed unless told otherwise. */
function world(on: On, entries: Record<string, unknown> = {}) {
  mock.store(on, entries);
  mock.clock(on, { now: 1_000_000 });
  on("tool.call", ($, e) => {
    if (e.tool === "Bash" && String(e.command).includes("pnpm view nope")) return { isError: true, result: "Error: Exit code 1\nERR_PNPM_FETCH_404" };
    if (e.tool === "Bash" && String(e.command).startsWith("pnpm view")) return { result: { stdout: "3.24.0\n", stderr: "", interrupted: false } };
    return { result: "ran" };
  });
  on("prompt.submit", ($, e) => ({ text: e.text }));
  // No settings hooks beneath: SessionStart adds nothing of its own.
  on("classic.SessionStart", () => ({}));
}

test("a dependency change is denied until a registry lookup succeeds", async ($, on) => {
  world(on);
  await $.classic.SessionStart({ source: "startup", session_id: "deny-then-allow" });
  const denied = await $.tool.call({ tool: "Bash", command: "pnpm add zod" });
  expect(denied.deny).toMatch(/`pnpm view zod version`/);
  await $.tool.call({ tool: "Bash", command: "pnpm view zod version" });
  expect(await $.tool.call({ tool: "Bash", command: "pnpm add zod" })).toEqual({ result: "ran" });
});

test("a failed lookup is not evidence", async ($, on) => {
  world(on);
  await $.classic.SessionStart({ source: "startup", session_id: "failed-lookup" });
  await $.tool.call({ tool: "Bash", command: "pnpm view nope version" });
  expect((await $.tool.call({ tool: "Bash", command: "pnpm add nope" })).deny).toMatch(/nope/);
});

test("a prompt that is not the person typing cannot turn the gate off", async ($, on) => {
  world(on);
  await $.classic.SessionStart({ source: "startup", session_id: "plugin-override" });
  await $.prompt.submit({ text: "hook override" } as any);
  expect((await $.tool.call({ tool: "Bash", command: "pnpm add zod" })).deny).toMatch(/zod/);
});

test("a resumed session keeps its evidence", async ($, on) => {
  world(on, {
    "ledger:resumed": { evidence: [{ kind: "registry", ecosystem: "npm", subject: "zod", source: "shell", at: 1 }], overrideUntil: 0, lastDenial: null, touchedAt: 1 }
  });
  await $.classic.SessionStart({ source: "resume", session_id: "resumed" });
  expect(await $.tool.call({ tool: "Bash", command: "pnpm add zod" })).toEqual({ result: "ran" });
});

test("the briefing reaches Claude at every session start", async ($, on) => {
  world(on);
  const started = await $.classic.SessionStart({ source: "clear", session_id: "briefed" });
  expect(started.additionalContext).toEqual(expect.arrayContaining([expect.stringContaining("Docs-first gate (action-level) is active")]));
});

test("/docs-gate lists the evidence and the last denial", async ($, on) => {
  world(on);
  await $.classic.SessionStart({ source: "startup", session_id: "reported" });
  await $.tool.call({ tool: "Bash", command: "pnpm add left-pad" });
  await $.tool.call({ tool: "Bash", command: "pnpm view zod version" });
  const report = await $.command.run({ command: "docs-gate" } as any);
  expect(report.text).toMatch(/registry \(npm\): zod/);
  expect(report.text).toMatch(/Last denial.*left-pad/);
});
