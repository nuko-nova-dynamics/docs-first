import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE_CAP, LEDGER_TTL_MS, Ledgers, emptyLedger, readLedger, record, type Store } from "./ledger.ts";
import type { Finding } from "./model.ts";

const docs = (subject: string): Finding => ({ kind: "docs", subject, source: "test" });

function memoryStore(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const copy = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    data,
    get: async (key) => copy(data.get(key)),
    set: async (key, value) => { data.set(key, copy(value)); },
    delete: async (key) => { data.delete(key); },
    keys: async () => [...data.keys()]
  };
}

test("record keeps one copy of each finding and caps the ledger", () => {
  const ledger = emptyLedger();
  assert.equal(record(ledger, [docs("zod"), docs("zod")], 1), true);
  assert.equal(record(ledger, [docs("zod")], 2), false);
  assert.equal(ledger.evidence.length, 1);
  record(ledger, Array.from({ length: EVIDENCE_CAP + 5 }, (_, i) => docs(`lib${i}`)), 3);
  assert.equal(ledger.evidence.length, EVIDENCE_CAP);
});

test("a stored ledger is read back defensively", () => {
  const ledger = readLedger({ evidence: [{ kind: "docs", subject: "zod", source: "x", at: 1 }, { kind: "other" }, null], overrideUntil: "5" });
  assert.deepEqual(ledger.evidence.map((e) => e.subject), ["zod"]);
  assert.equal(ledger.overrideUntil, 5);
  assert.deepEqual(readLedger("garbage"), emptyLedger());
});

test("changes made in parallel all reach the store, and a resumed session finds them", async () => {
  const store = memoryStore();
  const ledgers = new Ledgers();
  await Promise.all([
    ledgers.change(store, "S1", 1, (l) => record(l, [docs("a")], 1)),
    ledgers.change(store, "S1", 2, (l) => record(l, [docs("b")], 2))
  ]);
  const afterRestart = new Ledgers();
  assert.deepEqual((await afterRestart.get(store, "S1")).evidence.map((e) => e.subject), ["a", "b"]);
  assert.deepEqual((await afterRestart.get(store, "S2")).evidence, [], "a cleared session has a new id and starts empty");
});

test("sweeping removes only stale ledgers of other sessions", async () => {
  const store = memoryStore();
  const now = 100 * 86_400_000;
  store.data.set("ledger:old", { evidence: [], touchedAt: now - LEDGER_TTL_MS - 1 });
  store.data.set("ledger:recent", { evidence: [], touchedAt: now - 1000 });
  store.data.set("ledger:live", { evidence: [], touchedAt: 0 });
  store.data.set("other", 1);
  const ledgers = new Ledgers();
  await ledgers.get(store, "live");
  assert.equal(await ledgers.sweep(store, now), 1);
  assert.deepEqual([...store.data.keys()].sort(), ["ledger:live", "ledger:recent", "other"]);
});

test("a failed store read reaches the caller and is retried", async () => {
  const store = memoryStore();
  store.data.set("ledger:S", { evidence: [docs("zod")].map((f) => ({ ...f, at: 1 })), touchedAt: 1 });
  let failures = 1;
  const flaky: Store = { ...store, get: async (key) => { if (failures-- > 0) throw new Error("store unavailable"); return store.get(key); } };
  const ledgers = new Ledgers();
  await assert.rejects(ledgers.get(flaky, "S"), /store unavailable/);
  assert.deepEqual((await ledgers.get(flaky, "S")).evidence.map((e) => e.subject), ["zod"]);
});
