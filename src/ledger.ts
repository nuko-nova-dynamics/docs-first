// The ledger: the evidence and override one session holds, kept in the plugin's store under the session's id,
// so resuming a session keeps it and clearing a session (a new id) starts empty.

import type { Evidence, Finding } from "./model.ts";

export const EVIDENCE_CAP = 200;
export const OVERRIDE_MS = 15 * 60_000;
export const LEDGER_TTL_MS = 14 * 86_400_000;
const KEY_PREFIX = "ledger:";

export type Denial = { at: number; tool: string; reason: string };
export type Ledger = { evidence: Evidence[]; overrideUntil: number; lastDenial: Denial | null; touchedAt: number };

/** The plugin's store, as the mods API offers it. */
export type Store = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

export function emptyLedger(): Ledger {
  return { evidence: [], overrideUntil: 0, lastDenial: null, touchedAt: 0 };
}

/** A ledger read back from the store; anything malformed is dropped rather than trusted. */
export function readLedger(raw: unknown): Ledger {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const evidence = Array.isArray(r.evidence)
    ? r.evidence.filter((e): e is Evidence => !!e && typeof e === "object" && (e.kind === "registry" || e.kind === "docs") && typeof e.subject === "string" && e.subject.length > 0)
    : [];
  const d = r.lastDenial as Record<string, unknown> | null | undefined;
  const lastDenial = d && typeof d.reason === "string" ? { at: Number(d.at) || 0, tool: String(d.tool ?? ""), reason: d.reason } : null;
  return { evidence, overrideUntil: Number(r.overrideUntil) || 0, lastDenial, touchedAt: Number(r.touchedAt) || 0 };
}

const identity = (e: Evidence | Finding) => (e.kind === "registry" ? `registry:${e.ecosystem}:${e.subject}` : `docs:${e.subject}`);

/** Adds findings the ledger does not hold yet. True when something was added. */
export function record(ledger: Ledger, findings: readonly Finding[], now: number): boolean {
  const held = new Set(ledger.evidence.map(identity));
  let added = false;
  for (const f of findings) {
    const id = identity(f);
    if (held.has(id)) continue;
    held.add(id);
    ledger.evidence.push({ ...f, at: now } as Evidence);
    added = true;
  }
  if (ledger.evidence.length > EVIDENCE_CAP) ledger.evidence.splice(0, ledger.evidence.length - EVIDENCE_CAP);
  return added;
}

export function isOverridden(ledger: Ledger, now: number): boolean {
  return ledger.overrideUntil > now;
}

/**
 * Every session's ledger, loaded once per session and kept in memory. Changes mutate the one shared
 * object and then write it whole, so parallel tool calls (subagents included) never lose each other's evidence.
 */
export class Ledgers {
  private loaded = new Map<string, Promise<Ledger>>();

  /** The session's ledger. A failed read rejects, so the caller's failure handling runs, and is retried on the next call. */
  get(store: Store, sessionId: string): Promise<Ledger> {
    let ledger = this.loaded.get(sessionId);
    if (!ledger) {
      ledger = store.get(KEY_PREFIX + sessionId).then(readLedger);
      ledger.catch(() => this.loaded.delete(sessionId));
      this.loaded.set(sessionId, ledger);
    }
    return ledger;
  }

  /** Applies a change and writes the ledger when the change reports that it changed something. */
  async change(store: Store, sessionId: string, now: number, mutate: (ledger: Ledger) => boolean): Promise<Ledger> {
    const ledger = await this.get(store, sessionId);
    if (mutate(ledger)) {
      ledger.touchedAt = now;
      await store.set(KEY_PREFIX + sessionId, ledger);
    }
    return ledger;
  }

  /**
   * Deletes ledgers untouched for the TTL, sparing sessions loaded in this process. The store has no
   * compare-and-set, so a session another process resumes between this read and the delete can lose its
   * evidence; that needs a two-week-old session resumed within one store round trip, and costs a lookup.
   * Returns how many went.
   */
  async sweep(store: Store, now: number): Promise<number> {
    let removed = 0;
    for (const key of await store.keys()) {
      if (!key.startsWith(KEY_PREFIX) || this.loaded.has(key.slice(KEY_PREFIX.length))) continue;
      if (now - readLedger(await store.get(key)).touchedAt > LEDGER_TTL_MS) {
        await store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
