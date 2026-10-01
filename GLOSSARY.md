# Docs-first gate

A guard inside Claude Code that holds back a tool call depending on an outside technical fact (a package, its version, or a platform's API) until the session has checked a primary source for that fact.

## Language

### Gated actions

**Gated action**:
A tool call the gate judges before it runs, because it commits the project to an outside fact. It is a dependency change, a new external import, or a sensitive-file edit.
_Avoid_: trigger, risky call

**Dependency change**:
A gated action that adds, upgrades, re-pins, or scaffolds from a named package, through a package manager or by editing a dependency manifest.
_Avoid_: install

**New external import**:
A gated action that adds an import of a package the project neither declares nor has installed.
_Avoid_: unknown import

**Sensitive-file edit**:
A gated action that edits an auth, database schema or migration, billing or webhook, or deployment configuration file.
_Avoid_: sensitive surface

### Evidence

**Subject**:
The package or library name a gated action depends on, and that evidence vouches for.
_Avoid_: target

**Evidence**:
A record that this session consulted a primary source about a subject. It is either registry evidence or docs evidence.
_Avoid_: proof, research, unlock

**Registry evidence**:
Evidence from a package registry or from an installed package's own files. It vouches for exactly one package.

**Docs evidence**:
Evidence from official documentation, Context7, or a vendor's own tool server. It vouches for the family of packages that source documents, such as nextjs.org for `next` and `@next/*`.

**Coverage**:
A subject is covered when the session holds registry evidence for that exact package, or docs evidence for its family.
_Avoid_: match

**Ledger**:
The evidence and override a session holds. Resuming a session keeps it; clearing a session empties it.
_Avoid_: state, cache

### Decisions

**Denial**:
The gate's refusal of a gated action, naming each uncovered subject and its remedy.
_Avoid_: block, error

**Remedy**:
The lookup that would produce the missing evidence for one subject, such as `pnpm view zod version`.
_Avoid_: hint, fix

**Override**:
A phrase the user types, at their own terminal or through Remote Control, that suspends the gate for 15 minutes.
_Avoid_: bypass, escape hatch
