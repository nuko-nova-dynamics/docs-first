# docs-first

A Claude Code mod that stops Claude from building on a remembered fact about a package or platform. Three kinds of tool call wait until the session has checked the registry or the official docs:

| Gated action | Example | Needs evidence for |
| --- | --- | --- |
| Dependency change | `pnpm add zod`, `npx -y some-tool`, `pip install requests`, `brew install x`, or adding or re-pinning a dependency in `package.json` | each package it names |
| New external import | an Edit or Write that imports a package the project neither declares nor has installed | that package |
| Sensitive-file edit | auth middleware, a schema or migration, a billing or webhook handler, deployment or CI config | any library the file uses |

Everything else passes without a decision: reads, searches, agents, plans, prose and scratch files.

When the gate denies a call, the reason names each package that has no evidence and the lookup that would provide it, such as `pnpm view zod version`. So the way past the gate is to do the lookup.

## Evidence

The gate records evidence from tool calls that succeed:

- **Registry evidence** covers exactly one package. It comes from a registry lookup (`pnpm view`, `npm info`, `pip index versions`, `brew info`, `cargo info`, `go list`), a registry URL, or reading the package's own files under `node_modules`.
- **Docs evidence** covers the packages a source documents. Reading nextjs.org/docs covers `next` and `@next/*`; Stripe's docs cover `stripe` and `@stripe/*`. It comes from official docs pages, GitHub repositories, and a vendor's own MCP server.

Evidence for one package never covers another whose name merely contains it: checking `react` does not cover `react-native-svg`. A failed lookup or a 404 page records nothing.

Evidence lasts for the session, including its subagents, and survives `claude --resume`. `/clear` starts a new session with none. [GLOSSARY.md](GLOSSARY.md) defines each term.

## Using it

- `/docs-gate` shows the evidence the session holds and the last denial. It runs at once, even while Claude is working, and starts no turn.
- Typing `hook override` turns the gate off for 15 minutes. It works only when the user types it at the terminal or through Remote Control; a message from another session, a subagent, a scheduled task or `claude -p` cannot do it.
- A line under the prompt appears only while an override is on or the gate itself has failed. If the gate breaks, it allows calls and says so there rather than blocking work.
- Anthropic can switch Claude Code mods off remotely. When that happens the gate cannot run, so a message at session start says so, and Claude is told to check the docs anyway. The gate starts again by itself when mods come back.

## Install

Requires Claude Code 2.1.287 or later.

```
claude plugin marketplace add nuko-nova-dynamics/marketplace
claude plugin install docs-first@nuko-nova-tools
```

In a running session, `/reload-plugins` loads it.

A mod runs with your permissions. Before installing, `claude plugin validate <dir>` on a clone lists every event it hooks and every call it makes.

## Developing

```
pnpm install
pnpm test          # the rules, under node --test
pnpm test:mod      # the wiring, under claude plugin test
pnpm validate
claude -p "/docs-gate" --plugin-dir .   # once, so Claude Code writes the type declarations
pnpm typecheck
claude --plugin-dir .                   # a session that reloads the mod on save
```

`hooks/register.ts` is the only file that talks to Claude Code. The rules live in `src/` as plain TypeScript with no Claude Code or Node dependencies: `classify` decides which calls are gated actions, `observe` turns finished calls into evidence, `coverage` decides what evidence covers, `decide` writes the denial, and `ecosystems` holds one entry per package manager. Supporting another ecosystem means adding an entry there.

## License

MIT
