import assert from "node:assert/strict";
import test from "node:test";
import { covers, familyKey } from "./coverage.ts";
import type { Finding, Subject } from "./model.ts";

const npm = (name: string): Subject => ({ name, ecosystem: "npm" });
const registry = (subject: string, ecosystem: "npm" | "python" = "npm"): Finding => ({ kind: "registry", ecosystem, subject, source: "test" });
const docs = (subject: string): Finding => ({ kind: "docs", subject, source: "test" });

test("registry evidence covers exactly its own package", () => {
  assert.ok(covers(registry("zod"), npm("zod")));
  assert.ok(!covers(registry("react"), npm("react-native-svg")), "a name containing another is a different package");
  assert.ok(!covers(registry("zod"), npm("zod-to-json-schema")));
  assert.ok(!covers(registry("prisma"), npm("@prisma/client")));
  assert.ok(covers(registry("Pillow", "python"), { name: "pillow", ecosystem: "python" }), "registries compare case-insensitively");
  assert.ok(covers(registry("typing_extensions", "python"), { name: "typing-extensions", ecosystem: "python" }));
  assert.ok(!covers(registry("requests", "python"), npm("requests")), "evidence from one ecosystem says nothing about another");
});

test("docs evidence covers the family its source documents", () => {
  assert.ok(covers(docs("nextjs"), npm("next")));
  assert.ok(covers(docs("next.js"), npm("@next/font")));
  assert.ok(covers(docs("stripe"), npm("@stripe/stripe-js")));
  assert.ok(covers(docs("clerk"), npm("@clerk/nextjs")));
  assert.ok(covers(docs("react_dev"), npm("@types/react")), "a type package belongs to the package it types");
  assert.ok(covers(docs("convex"), npm("@convex-dev/auth")));
  assert.ok(!covers(docs("nextjs"), npm("next-auth")), "next-auth is its own project");
  assert.ok(!covers(docs("nextjs"), npm("@clerk/nextjs")), "a scoped package belongs to its scope");
  assert.ok(!covers(docs("react"), npm("react-native-svg")));
  assert.ok(covers(docs("@tanstack/react-query"), npm("@tanstack/react-query")), "docs naming a scoped package cover it");
  assert.ok(covers(docs("@prisma/client"), npm("@prisma/client")));
});

test("family keys drop domain and language suffixes", () => {
  assert.equal(familyKey("next.js"), "next");
  assert.equal(familyKey("threejs"), "three");
  assert.equal(familyKey("anthropic-ai"), "anthropic");
  assert.equal(familyKey("ai"), "ai", "a lone suffix word stays");
  assert.equal(familyKey("ejs"), "ejs");
});
