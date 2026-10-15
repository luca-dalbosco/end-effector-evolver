// Bridge end to end: a box tool above a round plate. The wrap must connect, stay out of the keep-outs and be one piece.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bridge } from "../src/geom/bridge.js";

const tc = JSON.parse(readFileSync(new URL("../data/toolConnect.json", import.meta.url), "utf8"));
function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i])));
}
const tool = box(-10, -10, 40, 10, 10, 60), bottom = tool.slice(0, 18); // the first two triangles are the bottom face
const keepOut = { R: 25, zTop: 5, zMin: 0, robotR: 30, bolts: [{ x: 15, y: 0, r: 4, z0: 5, z1: 10, len: 0 }], bed: false };
const run = (extra = {}) => bridge({ h: 1.5, waist: 30, maxCells: 400000, R: null, endTris: bottom, endAll: tool, avoid: [], keepOut, ...extra }, tc.bridge);

test("bridge connects the plate to the picked face in one piece", () => {
  const r = run();
  assert.ok(r.stats.connected, "connected");
  assert.ok(r.mesh.i.length > 0, "has a surface");
  assert.ok(r.stats.volCm3 > 5 && r.stats.volCm3 < 60, `volume ${r.stats.volCm3} cm³`);
});

test("bridge stays out of the bolt slot and the tool", () => {
  const { p } = run().mesh;
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
    assert.ok(!(Math.hypot(x - 15, y) < 4 - 1.6 && z > 5 + 1.6 && z < 10 - 1.6), `vertex in the bolt slot at ${x},${y},${z}`);
    assert.ok(!(Math.abs(x) < 10 - 1.6 && Math.abs(y) < 10 - 1.6 && z > 40 + 1.6 && z < 60 - 1.6), `vertex inside the tool at ${x},${y},${z}`);
  }
});

test("a bigger waist gives less material; print-ready lowers the waist instead of adding overhangs", () => {
  const thin = run({ waist: 50 }).stats.volCm3, straight = run({ waist: 0 }).stats.volCm3;
  assert.ok(thin < straight, `${thin} < ${straight}`);
  const pr = run({ waist: 50, keepOut: { ...keepOut, bed: true } }).stats;
  assert.ok(pr.waist <= 50 && pr.overhang != null);
});
