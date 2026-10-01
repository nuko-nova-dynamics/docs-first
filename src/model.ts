// The gate's vocabulary as types. GLOSSARY.md defines each term.

/** The package worlds the gate knows how to read. */
export type Ecosystem = "npm" | "python" | "brew" | "cargo" | "go";

/** A package or library name a gated action depends on. */
export type Subject = { name: string; ecosystem: Ecosystem };

/**
 * A record that the session consulted a primary source about a subject.
 * Registry evidence names one package of one ecosystem; docs evidence names a family.
 */
export type Evidence =
  | { kind: "registry"; ecosystem: Ecosystem; subject: string; source: string; at: number }
  | { kind: "docs"; subject: string; source: string; at: number };

/** Evidence before it is stamped with a time. */
export type Finding =
  | { kind: "registry"; ecosystem: Ecosystem; subject: string; source: string }
  | { kind: "docs"; subject: string; source: string };

/** A tool call the gate judges before it runs. */
export type GatedAction =
  | { kind: "dependency-change"; via: "command" | "manifest"; subjects: Subject[] }
  | { kind: "new-external-import"; file: string; subjects: Subject[] }
  | { kind: "sensitive-file-edit"; file: string; label: string; subjects: Subject[] };

/** The gate's answer for one tool call. */
export type Verdict = { allow: true } | { allow: false; reason: string };

/** A tool call as the gate reads it: the tool's name and its arguments as top-level fields. */
export type ToolCall = { readonly tool: string; readonly [field: string]: unknown };

/** What a tool call came back with, as far as the gate cares. */
export type ToolOutcome = { readonly succeeded: boolean; readonly text: string };

/** The project files the gate may read while classifying an edit. */
export type ProjectFiles = {
  /** The file's text, or null when it does not exist or cannot be read. */
  read(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
};
