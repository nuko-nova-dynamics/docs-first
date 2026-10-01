// The mod's wiring: the only file that talks to Claude Code. Everything it decides comes from ../src.

import type { EngineInterface, Register } from "claude-code";
import { BRIEFING, OVERRIDE_ACK } from "../src/briefing.ts";
import { classify } from "../src/classify.ts";
import { decide } from "../src/decide.ts";
import { Ledgers, OVERRIDE_MS, isOverridden, record, type Ledger, type Store } from "../src/ledger.ts";
import type { ProjectFiles, ToolCall, ToolOutcome, Verdict } from "../src/model.ts";
import { inlineFindings, observe } from "../src/observe.ts";
import { isOverrideRequest } from "../src/override.ts";
import { describe } from "../src/report.ts";

type Api = EngineInterface;

const GATED_TOOLS = new Set(["Bash", "Edit", "Write"]);

const ledgers = new Ledgers();
// The main session's id. Subagents' calls share it, so their evidence counts for the whole session.
// classic.SessionStart moves it on /clear (a new id) and /resume (the resumed one).
let sessionId = "";
// The last failure of the gate itself. While set, calls are allowed and the status line says why.
let gateError = "";
let overrideTimer: { cancel(): void } | null = null;

const storeOf = ($: Api): Store => ({
  get: (key) => $.store.get(key),
  set: (key, value) => $.store.set(key, value),
  delete: (key) => $.store.delete(key),
  keys: () => $.store.keys()
});

const filesOf = ($: Api): ProjectFiles => ({
  read: (path) => $.fs.read(path).catch(() => null),
  exists: (path) => $.fs.exists(path).catch(() => false)
});

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160);

async function currentSession($: Api): Promise<string> {
  if (!sessionId) sessionId = await $.session.id();
  return sessionId;
}

function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The status line: shown only while the gate is failing or overridden. */
function showStatus($: Api, ledger: Ledger, now: number): void {
  if (gateError) $.ui.status(`gate error, calls allowed: ${gateError}`);
  else if (isOverridden(ledger, now)) $.ui.status(`override on, gate off until ${clockTime(ledger.overrideUntil)}`);
  else $.ui.status(undefined);
}

async function refreshStatus($: Api): Promise<void> {
  const ledger = await ledgers.get(storeOf($), await currentSession($));
  const now = await $.clock.now();
  showStatus($, ledger, now);
  overrideTimer?.cancel();
  overrideTimer = isOverridden(ledger, now) ? $.clock.after(ledger.overrideUntil - now + 1_000, () => { void refreshStatus($); }) : null;
}

function fail($: Api, where: string, err: unknown): void {
  gateError = `${where}: ${message(err)}`;
  $.ui.status(`gate error, calls allowed: ${gateError}`);
  $.ui.log(`docs-first ${gateError}`, { to: "debug" });
}

async function judge($: Api, call: ToolCall): Promise<Verdict | null> {
  if (!GATED_TOOLS.has(call.tool)) return null;
  const cwd = call.tool === "Bash" ? "" : await $.session.cwd();
  const actions = await classify(call, filesOf($), cwd);
  if (!actions.length) return null;
  const ledger = await ledgers.get(storeOf($), await currentSession($));
  if (isOverridden(ledger, await $.clock.now())) return null;
  const inline = call.tool === "Bash" ? inlineFindings(String(call.command ?? "")) : [];
  return decide(actions, [...ledger.evidence, ...inline], cwd);
}

function outcomeOf(result: unknown): ToolOutcome {
  const r = (result ?? {}) as { deny?: unknown; isError?: unknown; text?: unknown; result?: unknown };
  const succeeded = r.deny === undefined && !r.isError;
  if (typeof r.text === "string") return { succeeded, text: r.text };
  if (typeof r.result === "string") return { succeeded, text: r.result };
  try {
    return { succeeded, text: JSON.stringify(r.result ?? "").slice(0, 4000) };
  } catch {
    return { succeeded, text: "" };
  }
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    sessionId = await $.session.id();
    $.clock.after(5_000, () => { void ledgers.sweep(storeOf($), Date.now()).catch((err) => fail($, "sweeping old ledgers", err)); });
    try {
      await refreshStatus($);
    } catch (err) {
      fail($, "loading the ledger", err);
    }
    try {
      await $.command.register({ name: "docs-gate", description: "Show the docs-first gate: evidence held, override, last denial", immediate: true });
    } catch (err) {
      $.ui.log(`docs-first: /docs-gate not registered: ${message(err)}`, { to: "debug" });
    }
    return result;
  });

  on("classic.SessionStart", async ($, e, next) => {
    const result = await next(e);
    if (typeof e.session_id === "string" && e.session_id && e.session_id !== sessionId) {
      sessionId = e.session_id;
      // /clear and /resume switch ledgers: the status line and override timer follow the new one.
      try {
        await refreshStatus($);
      } catch (err) {
        fail($, "loading the ledger", err);
      }
    }
    return { ...result, additionalContext: [...(result.additionalContext ?? []), BRIEFING] };
  });

  on("prompt.submit", async ($, e, next) => {
    if (!isOverrideRequest(e.text, e.origin.kind)) return next(e);
    let accepted = false;
    try {
      const now = await $.clock.now();
      await ledgers.change(storeOf($), await currentSession($), now, (ledger) => {
        ledger.overrideUntil = now + OVERRIDE_MS;
        return true;
      });
      accepted = true;
      await refreshStatus($);
    } catch (err) {
      fail($, "recording the override", err);
    }
    return accepted ? next({ ...e, context: [...(e.context ?? []), OVERRIDE_ACK] }) : next(e);
  });

  on("tool.call", async ($, e, next) => {
    const call = e as unknown as ToolCall;
    let verdict: Verdict | null = null;
    try {
      verdict = await judge($, call);
      if (gateError) {
        gateError = "";
        await refreshStatus($);
      }
    } catch (err) {
      fail($, `judging ${call.tool}`, err);
    }
    if (verdict && !verdict.allow) {
      const reason = verdict.reason;
      try {
        const now = await $.clock.now();
        await ledgers.change(storeOf($), await currentSession($), now, (ledger) => {
          ledger.lastDenial = { at: now, tool: call.tool, reason };
          return true;
        });
      } catch (err) {
        $.ui.log(`docs-first: could not record the denial: ${message(err)}`, { to: "debug" });
      }
      return { deny: reason };
    }

    const result = await next(e);
    try {
      const findings = observe(call, outcomeOf(result));
      if (findings.length) {
        const now = await $.clock.now();
        await ledgers.change(storeOf($), await currentSession($), now, (ledger) => record(ledger, findings, now));
      }
    } catch (err) {
      fail($, "recording evidence", err);
    }
    return result;
  });

  on("command.run", { command: "docs-gate" }, async ($) => {
    const ledger = await ledgers.get(storeOf($), await currentSession($));
    return { text: describe(ledger, await $.clock.now(), gateError) };
  });
};
