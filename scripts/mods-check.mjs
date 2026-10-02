#!/usr/bin/env node
// A settings hook, not a mod: it runs at session start even when Anthropic has switched Claude Code mods off,
// which is exactly when the gate goes quiet. It reads the flag Claude Code caches from Anthropic and, when mods
// are off, tells the person and Claude that the docs-first gate is not running.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const configDir = process.env.CLAUDE_CONFIG_DIR || os.homedir();
const cache = path.join(configDir, ".claude.json");

let state;
try {
  state = JSON.parse(fs.readFileSync(cache, "utf8"));
} catch {
  process.exit(0);
}

// The flag Claude Code reads to decide whether installed mods load ("the rollout switch").
const enabled = state?.cachedGrowthBookFeatures?.tengu_plugin_hooks_modules;
if (enabled !== false) process.exit(0);

const fetchedAt = Number(state?.cachedGrowthBookFeaturesAt) || 0;
const asOf = fetchedAt ? ` (as of ${new Date(fetchedAt).toISOString().slice(0, 16).replace("T", " ")} UTC)` : "";

process.stdout.write(JSON.stringify({
  systemMessage: `docs-first is not running: Anthropic has Claude Code mods switched off${asOf}. The gate starts again by itself when they turn mods back on.`,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: "The docs-first gate is not active in this session, because Claude Code mods are switched off remotely. Check the registry or the official docs anyway before dependency changes, new imports, and auth, schema, billing or deployment edits, and end such answers with a short Evidence checked section."
  }
}));
