import assert from "node:assert/strict";
import test from "node:test";
import { isOverrideRequest } from "./override.ts";

test("the override works only when the person types it", () => {
  assert.ok(isOverrideRequest("hook override", "composer"));
  assert.ok(isOverrideRequest("DOCS_FIRST_OVERRIDE: just do it", "composer"));
  assert.ok(isOverrideRequest("hook override", "bridge"), "Remote Control is the person too");
  for (const origin of ["peer", "peer-send-message", "sdk", "task-notification", "scheduled-trigger", "channel", "plugin", "unclassified"]) {
    assert.ok(!isOverrideRequest("hook override", origin), origin);
  }
  assert.ok(!isOverrideRequest("please do not override the hook", "composer"));
});
