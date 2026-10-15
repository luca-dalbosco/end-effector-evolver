// Undo / redo (src/history.js): order, redo cleared by a new action, the 100-step limit frees old steps, no recording while replaying.
import { test } from "node:test";
import assert from "node:assert/strict";

const doc = new EventTarget(); // just enough of a page for history.js: the status line and the stage tabs
doc.getElementById = () => ({ dataset: {} }); doc.querySelector = () => null;
globalThis.document ??= doc;
const { record, undo, redo, isReplaying } = await import("../src/history.js");

test("undo and redo run in the right order; a new action clears redo", () => {
  let v = 0; const log = [];
  const set = (x) => { v = x; log.push(x); };
  set(1); record("one", () => set(0), () => set(1));
  set(2); record("two", () => set(1), () => set(2));
  undo(); undo(); assert.equal(v, 0);
  redo(); assert.equal(v, 1);
  set(5); record("five", () => set(1), () => set(5));
  redo(); assert.equal(v, 5); // nothing to redo: "two" was dropped by the new action
  assert.deepEqual(log, [1, 2, 1, 0, 1, 5]);
});

test("old steps fall off after 100 and are freed; replaying records nothing", () => {
  let freed = 0, inside = null;
  for (let k = 0; k < 105; k++) record("step " + k, () => { inside = isReplaying(); record("nested", () => {}, () => {}); }, () => {}, () => freed++);
  assert.equal(freed, 5 + 0); // the 5 oldest of this test (earlier steps have no dispose)
  undo(); assert.equal(inside, true); assert.equal(isReplaying(), false);
  let redone = 0; record("last", () => {}, () => redone++); undo(); redo();
  assert.equal(redone, 1); // the nested record() during the replay did not clear the redo list or add a step
});
