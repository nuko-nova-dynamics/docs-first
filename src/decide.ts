// Whether the evidence in hand covers a call's gated actions, and the denial when it does not.

import { isCovered } from "./coverage.ts";
import { remedyFor } from "./ecosystems.ts";
import type { Evidence, Finding, GatedAction, Subject, Verdict } from "./model.ts";
import { shorten } from "./paths.ts";

const names = (subjects: readonly Subject[]) => subjects.map((s) => s.name).join(", ");
const them = (subjects: readonly unknown[]) => (subjects.length > 1 ? "them" : "it");
const remedies = (subjects: readonly Subject[]) => subjects.map((s) => `\`${remedyFor(s)}\``).join("; ");

// `reason` is what Claude reads; `summary` is one short line for a person (statusline-hud's band).
type Denial = { reason: string; summary: string };

function denial(action: GatedAction, evidence: readonly (Evidence | Finding)[], cwd: string): Denial | null {
  if (action.kind === "sensitive-file-edit") {
    const file = shorten(cwd, action.file);
    if (action.subjects.length) {
      if (action.subjects.some((s) => isCovered(evidence, s))) return null;
      return {
        reason: `${file} is a sensitive file (${action.label}) and this session has no current docs or registry evidence for any library it uses (${names(action.subjects.slice(0, 6))}). Read the current docs for the one this change depends on (a Context7 query, the official docs, a registry view, or the vendor's MCP), then retry.`,
        summary: `editing ${file}: needs docs or registry evidence for one of ${names(action.subjects.slice(0, 3))}${action.subjects.length > 3 ? ", ..." : ""}`
      };
    }
    if (evidence.length) return null;
    return {
      reason: `${file} is a sensitive file (${action.label}) and this session has consulted no docs or registry data yet. Check the docs of the platform or library this change depends on, then retry.`,
      summary: `editing ${file}: needs a docs lookup first`
    };
  }

  const known = action.kind === "dependency-change" && action.inline ? [...evidence, ...action.inline] : evidence;
  const missing = action.subjects.filter((s) => !isCovered(known, s));
  if (!missing.length) return null;
  const lookup = `Run ${remedies(missing)}, or read ${them(missing) === "it" ? "its" : "their"} official docs or Context7`;
  const needs = "needs registry or docs evidence";
  if (action.kind === "dependency-change" && action.via === "manifest") {
    return {
      reason: `this edit adds or re-pins ${names(missing)} in package.json with no registry or docs evidence for ${them(missing)} this session. ${lookup}, so the version you pin is current, then retry.`,
      summary: `pinning ${names(missing)} in package.json: ${needs}`
    };
  }
  if (action.kind === "dependency-change") {
    return {
      reason: `this command adds, upgrades or installs ${names(missing)} with no registry or docs evidence for ${them(missing)} this session. ${lookup}, confirm the version and API you intend to use, then retry.`,
      summary: `changing ${names(missing)}: ${needs}`
    };
  }
  return {
    reason: `this edit imports ${names(missing)}, which the nearest package.json does not declare and node_modules does not contain, and this session has no registry or docs evidence for ${them(missing)}. ${lookup}, add the dependency, then retry.`,
    summary: `importing ${names(missing)}: ${needs}`
  };
}

/** Allows the call when the evidence covers every gated action it takes; otherwise denies with one reason per uncovered action. */
export function decide(actions: readonly GatedAction[], evidence: readonly (Evidence | Finding)[], cwd: string): Verdict {
  const denials = actions.map((a) => denial(a, evidence, cwd)).filter((d): d is Denial => d !== null);
  if (!denials.length) return { allow: true };
  return {
    allow: false,
    reason: `docs-first: ${denials.map((d) => d.reason).join(" Also, ")}`,
    summary: denials.map((d) => d.summary).join("; ")
  };
}
