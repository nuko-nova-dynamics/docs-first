// The text /docs-gate prints: what the gate holds for this session.

import { isOverridden, type Ledger } from "./ledger.ts";

const SHOWN = 30;

function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

export function describe(ledger: Ledger, now: number, gateError: string): string {
  const state = gateError
    ? `failing, so calls are allowed (${gateError})`
    : isOverridden(ledger, now)
      ? `overridden for ${Math.ceil((ledger.overrideUntil - now) / 60_000)} more min`
      : "active";
  const lines = [`Gate: ${state}`];
  const evidence = ledger.evidence;
  if (!evidence.length) {
    lines.push("Evidence: none yet this session.");
  } else {
    lines.push(`Evidence (${evidence.length}${evidence.length > SHOWN ? `, newest ${SHOWN} shown` : ""}):`);
    for (const e of evidence.slice(-SHOWN)) {
      const kind = e.kind === "registry" ? `registry (${e.ecosystem})` : "docs";
      lines.push(`  ${kind}: ${e.subject}, from ${e.source}, ${ago(now - e.at)}`);
    }
  }
  if (ledger.lastDenial) lines.push(`Last denial, ${ago(now - ledger.lastDenial.at)}, ${ledger.lastDenial.tool}: ${ledger.lastDenial.reason}`);
  return lines.join("\n");
}
