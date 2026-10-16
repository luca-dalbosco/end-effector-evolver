// Meshes written to files must be watertight: every edge shared by exactly two triangles (vertices welded by position).
import { test } from "node:test";
import assert from "node:assert/strict";
import { exposed, surfaceNets } from "../src/geom/mesh.js";

const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// returns { bad: edges not shared by exactly 2 triangles, flipped: edges whose two triangles run the same way }
function edgeReport(m) {
  const id = new Map(), vid = (k) => { const key = `${m.p[3 * k].toFixed(4)},${m.p[3 * k + 1].toFixed(4)},${m.p[3 * k + 2].toFixed(4)}`; if (!id.has(key)) id.set(key, id.size); return id.get(key); };
  const e = new Map();
  for (let t = 0; t < m.i.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = vid(m.i[t + k]), b = vid(m.i[t + (k + 1) % 3]); if (a === b) continue;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`, rec = e.get(key) || { n: 0, dir: 0 }; rec.n++; rec.dir += a < b ? 1 : -1; e.set(key, rec);
  }
  let bad = 0, flipped = 0; for (const r of e.values()) { if (r.n !== 2) bad++; else if (r.dir !== 0) flipped++; }
  return { bad, flipped };
}

function noisy(n, seed, p) { const r = rnd(seed), a = new Float32Array(n * n * n); for (let c = 0; c < a.length; c++) a[c] = r() < p ? 1 : 0; return a; }

test("exposed(): noisy voxels give a watertight mesh", () => {
  const n = 12, m = exposed(noisy(n, 5, 0.5), n, n, n, 1, [0, 0, 0]);
  assert.deepEqual(edgeReport(m), { bad: 0, flipped: 0 });
});

test("exposed(): two voxels touching only along an edge", () => {
  const n = 4, mask = new Uint8Array(n * n * n); mask[0 + n * (0 + n * 0)] = 1; mask[1 + n * (1 + n * 0)] = 1;
  assert.deepEqual(edgeReport(exposed(mask, n, n, n, 1, [0, 0, 0])), { bad: 0, flipped: 0 });
});

test("surfaceNets(): noisy field gives a watertight mesh", () => {
  const n = 12, f = noisy(n, 9, 0.5); for (let c = 0; c < f.length; c++) f[c] = f[c] ? 0.6 + 0.4 * Math.random() : 0.4 * Math.random();
  assert.deepEqual(edgeReport(surfaceNets(f, n, n, n, 1, [0, 0, 0])), { bad: 0, flipped: 0 });
});

test("3MF: vertices are shared, so the closed mesh stays closed in the file", async () => {
  const { weld } = await import("../src/geom/export.js");
  const n = 6, m = exposed(noisy(n, 3, 0.5), n, n, n, 1, [0, 0, 0]), w = weld(m.p, m.i);
  assert.ok(w.p.length < m.p.length);
  assert.deepEqual(edgeReport({ p: w.p, i: w.i }), { bad: 0, flipped: 0 });
});
