// The override: a phrase the user types that turns the gate off for a while.

const OVERRIDE_RE = /(?:DOCS_FIRST_OVERRIDE|HOOK_OVERRIDE|RESEARCH_GATE_OVERRIDE)\s*:|(?:^|\n)\s*(?:hook override|docs[- ]first override|override docs[- ]first|research gate override|override research gate)\b/i;

// Prompt origins that are the person: typed at their terminal, or sent through Remote Control.
// Everything else (other sessions, subagents, scheduled tasks, task notifications, channels, plugins,
// `claude -p` callers such as Codex) is never the person and cannot turn the gate off.
const PERSON_ORIGINS = new Set(["composer", "bridge"]);

export function isOverrideRequest(text: string, originKind: string): boolean {
  return PERSON_ORIGINS.has(originKind) && OVERRIDE_RE.test(String(text || ""));
}
