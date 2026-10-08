// docs-first's shared state: what other mods (statusline-hud) may read.

/** The gate's last denial, until evidence or an allowed call clears it. */
export type DocsFirstBlock = { at: number; tool: string; summary: string };

declare module "claude-code" {
  interface PluginState {
    "docs-first": { block: DocsFirstBlock | null };
  }
}
