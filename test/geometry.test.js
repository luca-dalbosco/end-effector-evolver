// Triangles, voxelization, hull, meshes, keep-outs, loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { triDist2, meshBand, samplePoints } from "../src/geom/tri.js";
import { voxelizeSolid, solidCentroid, nodalLoads } from "../src/geom/voxelize.js";
import { convexHull } from "../src/geom/hull.js";
import { exposed, surfaceNets } from "../src/geom/mesh.js";
import { slotDist, keepOutDist, overhangs } from "../src/geom/keepout.js";
import { loadVector } from "../src/geom/load.js";

const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// closed box from (x0,y0,z0) to (x1,y1,z1), outward normals, 12 triangles
function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i])));
}

test("triDist2 matches dense sampling of the triangle", () => {
  const t = [0, 0, 0, 4, 0, 0, 1, 3, 0], r = rnd(11);
  for (let k = 0; k < 40; k++) {
    const p = [r() * 8 - 2, r() * 8 - 2, r() * 4 - 2]; let best = Infinity;
    for (let i = 0; i <= 200; i++) for (let j = 0; j <= 200 - i; j++) {
      const s = i / 200, u = j / 200, x = 4 * s + u, y = 3 * u;
      best = Math.min(best, (p[0] - x) ** 2 + (p[1] - y) ** 2 + p[2] ** 2);
    }
    const d = triDist2(p[0], p[1], p[2], t, 0);
    assert.ok(d <= best + 1e-9 && best - d < 0.05, `point ${p}: ${d} vs ${best}`);
  }
});

test("meshBand: exact distance near the mesh, BIG far away", () => {
  const tris = box(0, 0, 0, 10, 10, 10), h = 1, org = [-5, -5, -5], n = 20, d = meshBand(tris, n, n, n, org, h, 2);
  const at = (x, y, z) => d[Math.floor((x - org[0]) / h) + n * (Math.floor((y - org[1]) / h) + n * Math.floor((z - org[2]) / h))];
  assert.ok(Math.abs(at(-1.5, 5.5, 5.5) - 1.5) < 1e-5);
  assert.ok(at(-4.5, 5.5, 5.5) > 1e8);
});

test("samplePoints covers the triangles", () => {
  const p = samplePoints(box(0, 0, 0, 10, 10, 10), 1, null);
  assert.ok(p.length / 3 > 6 * 100, `${p.length / 3} points`);
});

test("voxelizeSolid fills a box with the right number of cells", () => {
  const n = 20, m = voxelizeSolid(box(2, 2, 2, 12, 8, 6), n, n, n, [0, 0, 0], 1);
  assert.equal(m.reduce((a, v) => a + v, 0), 10 * 6 * 4);
});

test("solidCentroid of a box is its centre", () => {
  const c = solidCentroid(box(2, 2, 2, 12, 8, 6));
  [7, 5, 4].forEach((v, a) => assert.ok(Math.abs(c[a] - v) < 1e-5));
});

test("nodalLoads: forces add up to F (scaled to 1) and the moment about the nodes is right", () => {
  const pos = [], r = rnd(5); for (let i = 0; i < 30; i++) pos.push(r() * 10, r() * 10, 0);
  const F = [0, -30, 0], P = [5, 5, 40], out = nodalLoads(Float64Array.from(pos), F, P), n = pos.length / 3, fm = 30;
  const sum = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { sum[a] += out[3 * i + a]; c[a] += pos[3 * i + a] / n; }
  F.forEach((v, a) => assert.ok(Math.abs(sum[a] - v / fm) < 1e-9));
  const M = [0, 0, 0];
  for (let i = 0; i < n; i++) { const rr = [0, 1, 2].map((a) => pos[3 * i + a] - c[a]), f = [0, 1, 2].map((a) => out[3 * i + a]); M[0] += rr[1] * f[2] - rr[2] * f[1]; M[1] += rr[2] * f[0] - rr[0] * f[2]; M[2] += rr[0] * f[1] - rr[1] * f[0]; }
  const d = P.map((v, a) => v - c[a]), Mx = [d[1] * F[2] - d[2] * F[1], d[2] * F[0] - d[0] * F[2], d[0] * F[1] - d[1] * F[0]].map((v) => v / fm);
  // the nodes lie in one plane, so the moment about the plane normal axis and the in-plane ones are all carried
  Mx.forEach((v, a) => assert.ok(Math.abs(M[a] - v) < 1e-6, `moment ${a}: ${M[a]} vs ${v}`));
});

test("convexHull: every input point is inside, outside points are not", () => {
  const r = rnd(9), pts = []; for (let i = 0; i < 200; i++) pts.push(r() * 10, r() * 10, r() * 10);
  const pl = convexHull(pts), inside = (x, y, z) => { for (let i = 0; i < pl.length; i += 4) if (pl[i] * x + pl[i + 1] * y + pl[i + 2] * z - pl[i + 3] > 1e-6) return false; return true; };
  for (let i = 0; i < pts.length; i += 3) assert.ok(inside(pts[i], pts[i + 1], pts[i + 2]));
  assert.ok(!inside(20, 5, 5) && !inside(-1, -1, -1));
});

test("exposed: one voxel gives 6 squares", () => {
  const m = exposed(Uint8Array.from([1]), 1, 1, 1, 2, [0, 0, 0]);
  assert.equal(m.i.length / 6, 6);
});

test("surfaceNets: a ball gives a closed surface (every edge used by two triangles)", () => {
  const n = 14, f = new Float32Array(n ** 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) f[x + n * (y + n * z)] = Math.max(0, Math.min(1, 0.5 + (4.5 - Math.hypot(x - 6.5, y - 6.5, z - 6.5)) / 2));
  const m = surfaceNets(f, n, n, n, 1, [0, 0, 0]), edges = new Map();
  for (let t = 0; t < m.i.length; t += 3) for (let e = 0; e < 3; e++) { const a = m.i[t + e], b = m.i[t + (e + 1) % 3], k = Math.min(a, b) + "," + Math.max(a, b); edges.set(k, (edges.get(k) || 0) + 1); }
  assert.ok(m.i.length > 0);
  for (const [k, v] of edges) assert.equal(v, 2, `edge ${k}`);
});

test("slotDist and keepOutDist", () => {
  const b = { x: 10, y: 0, r: 3, len: 5, z0: 5, z1: 10 };
  assert.equal(slotDist(b, 13, 0), 0); // on the slot line
  assert.equal(slotDist(b, 20, 0), 5); // 5 mm past the slot end
  const k = { R: 20, zTop: 5, zMin: 0, robotR: 25, bolts: [b], bed: false };
  assert.ok(keepOutDist(k, 0, 0, 2) < 0, "inside the plate");
  assert.ok(keepOutDist(k, 0, 0, 30) > 0, "above everything");
  assert.ok(keepOutDist(k, 12, 0, 7) < 0, "inside a bolt slot");
  assert.ok(keepOutDist({ ...k, bed: true }, 40, 0, 2) < 0, "below the bed when print-ready");
});

test("overhangs: a floating cell counts, a supported one does not", () => {
  const nx = 3, ny = 3, nz = 4, N = nx * ny * nz, z0 = new Uint8Array(N), g = { nx, ny, nz, org: [0, 0, 0], h: 1, srcA: z0, srcB: z0 }, k = { zTop: 0, bed: true };
  const m = new Uint8Array(N); m[4] = 1; m[4 + 9] = 1; m[4 + 27] = 1; // column at z 0 and 1, a floating cell at z 3
  assert.equal(overhangs(m, g, k), 1);
  assert.equal(overhangs(m, g, { zTop: 0, bed: false }), null);
});

test("loadVector: weight × acceleration along the direction, plus extra", () => {
  const F = loadVector("-Z", 2, 3, [1, 0, 0]);
  assert.ok(Math.abs(F[2] + 2 * 3 * 9.81) < 1e-9 && F[0] === 1 && F[1] === 0);
});
