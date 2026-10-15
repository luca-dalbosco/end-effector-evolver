// Worker messages (src/rpc.js): replies reach the right request, serial() drops overtaken requests, a crash unlocks everyone.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document ??= new EventTarget(); // rpc.js tells the 3D view to redraw through a document event
const { rpc, serial } = await import("../src/rpc.js");

// a stand-in worker: keeps what was posted; reply() and crash() act like the real one
function fakeWorker() {
  const w = new EventTarget(); w.sent = [];
  w.postMessage = (m) => w.sent.push(m);
  w.reply = (m) => w.dispatchEvent(Object.assign(new Event("message"), { data: m }));
  w.crash = (message) => w.dispatchEvent(Object.assign(new Event("error", { cancelable: true }), { message }));
  return w;
}

test("rpc: replies go to the request with the same id; progress replies keep it waiting", () => {
  const w = fakeWorker(), call = rpc(w), got = [];
  const a = call("x", {}, (m) => got.push(["a", m.v])), b = call("x", {}, (m) => got.push(["b", m.v]));
  w.reply({ rid: b, v: 1, more: true }); w.reply({ rid: a, v: 2 }); w.reply({ rid: b, v: 3 }); w.reply({ rid: b, v: 4 });
  assert.deepEqual(got, [["b", 1], ["a", 2], ["b", 3]]); // the 4th reply finds no one: b was finished
});

test("rpc: a crash answers every waiting request with an error, and every later one too", async () => {
  const w = fakeWorker(), dead = [], call = rpc(w, "test engine", (t) => dead.push(t)), got = [];
  call("long", {}, (m) => got.push(m));
  w.crash("out of memory");
  assert.equal(got.length, 1); assert.equal(got[0].ok, false); assert.match(got[0].error, /test engine stopped \(out of memory\)/);
  assert.equal(dead.length, 1);
  const later = await new Promise((r) => call("next", {}, r));
  assert.equal(later.ok, false); assert.equal(w.sent.length, 1); // nothing more is sent to a dead worker
});

test("serial: one at a time, only the newest waiting request runs, overtaken replies are hidden", () => {
  const w = fakeWorker(), send = serial(rpc(w), "build"), shown = [];
  send({ n: 1 }, (m) => shown.push(m.n)); send({ n: 2 }, (m) => shown.push(m.n)); send({ n: 3 }, (m) => shown.push(m.n));
  assert.deepEqual(w.sent.map((m) => m.n), [1]); // 2 and 3 wait; 3 replaces 2
  w.reply({ rid: w.sent[0].rid, n: 1 });
  assert.deepEqual(w.sent.map((m) => m.n), [1, 3]); assert.deepEqual(shown, []); // 1 was overtaken: not shown
  w.reply({ rid: w.sent[1].rid, n: 3 });
  assert.deepEqual(shown, [3]);
});
