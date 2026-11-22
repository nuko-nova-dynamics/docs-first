// The override: a phrase the user types that turns the gate off for a while.

const OVERRIDE_RE = /(?:DOCS_FIRST_OVERRIDE|HOOK_OVERRIDE|RESEARCH_GATE_OVERRIDE)\s*:|(?:^|\n)\s*(?:hook override|docs[- ]first override|override docs[- ]first|research gate override|override research gate)\b/i;

// Prompt origins that are the person: typed at their terminal, or sent through Remote Control.
// Everything else (other sessions, subagents, scheduled tasks, task notifications, channels, plugins,
// `claude -p` callers such as Codex) is never the person and cannot turn the gate off.
const PERSON_ORIGINS = new Set(["composer", "bridge"]);

// T3 Code runs Claude through the Agent SDK, so a message the person types there arrives with origin `sdk`,
// the same as a prompt an agent sends to a T3 thread. Under T3 the gate accepts `sdk` and takes that risk;
// under any other entrypoint `sdk` stays a program, never the person.
const T3_ENTRYPOINT = "t3-code";

export function isOverrideRequest(text: string, originKind: string, entrypoint?: string): boolean {
  const person = PERSON_ORIGINS.has(originKind) || (originKind === "sdk" && entrypoint === T3_ENTRYPOINT);
  return person && OVERRIDE_RE.test(String(text || ""));
}
