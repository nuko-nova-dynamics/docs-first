// When evidence covers a subject. Registry evidence covers exactly its package;
// docs evidence covers the family of packages its source documents.

import type { Ecosystem, Evidence, Finding, Subject } from "./model.ts";

// Trailing words that name a domain, a language or an organization form, not a library.
const SUFFIX_WORDS = new Set(["js", "ts", "dev", "io", "com", "org", "net", "app", "sh", "docs", "hq", "labs", "inc", "ai"]);

/**
 * The family a name belongs to: its words lowercased and joined, trailing suffix words dropped.
 * `next.js`, `nextjs` and `next` → next; `convex-dev` → convex; `react_dev` → react; `react-native-svg` stays its own.
 */
export function familyKey(raw: string): string {
  const words = String(raw || "").toLowerCase().replace(/^npm:/, "").split(/[^a-z0-9]+/).filter(Boolean);
  while (words.length > 1 && SUFFIX_WORDS.has(words[words.length - 1] ?? "")) words.pop();
  let key = words.join("");
  if (key.length > 4 && key.endsWith("js")) key = key.slice(0, -2);
  return key;
}

/**
 * The families a package belongs to. A scoped npm package belongs to its scope's family
 * (`@stripe/stripe-js` → stripe, `@next/font` → next); a type package to the package it types
 * (`@types/react` → react); a Go module to its last path element.
 */
export function familiesOf(subject: Subject): string[] {
  const { name, ecosystem } = subject;
  if (ecosystem === "npm") {
    const [, scope, rest = ""] = name.match(/^@([^/]+)\/(.+)$/) ?? [];
    if (scope === "types") {
      // DefinitelyTyped spells @scope/pkg as @types/scope__pkg.
      const typed = rest.includes("__") ? `@${rest.replace("__", "/")}` : rest;
      return familiesOf({ name: typed, ecosystem });
    }
    if (scope) return [familyKey(scope)];
  }
  if (ecosystem === "go") return [familyKey(name.split("/").pop() || name)];
  return [familyKey(name)];
}

/** A package name as its registry compares it: case-insensitive, and Python treats `-`, `_` and `.` alike. */
export function canonicalName(name: string, ecosystem: Ecosystem): string {
  const n = String(name || "").trim().toLowerCase().replace(/^npm:/, "");
  return ecosystem === "python" ? n.replace(/[-_.]+/g, "-") : n;
}

export function covers(evidence: Evidence | Finding, subject: Subject): boolean {
  if (evidence.kind === "registry") {
    return evidence.ecosystem === subject.ecosystem && canonicalName(evidence.subject, evidence.ecosystem) === canonicalName(subject.name, subject.ecosystem);
  }
  // A docs subject is read the way a package name is, so docs naming `@tanstack/react-query` cover the tanstack family.
  const keys = familiesOf({ name: evidence.subject, ecosystem: "npm" }).filter(Boolean);
  const families = familiesOf(subject);
  return keys.some((key) => families.includes(key));
}

export function isCovered(evidence: readonly (Evidence | Finding)[], subject: Subject): boolean {
  return evidence.some((e) => covers(e, subject));
}
