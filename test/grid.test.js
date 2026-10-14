// Voxel grid helpers: distance fields, blur, volume hold, flood fill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BIG, edt, distTo, signedDist, blur3, holdVolume, flood } from "../src/geom/grid.js";

const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647); // repeatable random numbers

test("edt equals the brute-force squared distance", () => {
  const nx = 9, ny = 7, nz = 6, N = nx * ny * nz, r = rnd(7), src = [];
  const f = new Float64Array(N).fill(BIG);
  for (let c = 0; c < N; c++) if (r() < 0.04) { f[c] = 0; src.push(c); }
  edt(f, nx, ny, nz);
  for (let c = 0; c < N; c++) {
    const x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    let best = Infinity;
    for (const s of src) { const X = s % nx, Y = Math.floor(s / nx) % ny, Z = Math.floor(s / (nx * ny)); best = Math.min(best, (x - X) ** 2 + (y - Y) ** 2 + (z - Z) ** 2); }
    assert.equal(f[c], best, `cell ${c}`);
  }
});

test("distTo and signedDist: zero on the mask, sign flips across the surface", () => {
  const n = 12, N = n ** 3, mask = new Uint8Array(N);
  for (let z = 3; z < 9; z++) for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) mask[x + n * (y + n * z)] = 1;
  const d = distTo(mask, n, n, n);
  assert.equal(d[5 + n * (5 + n * 5)], 0);
  assert.equal(d[0 + n * (5 + n * 5)], 3); // 3 cells left of the cube
  const s = signedDist(mask, n, n, n);
  assert.ok(s[5 + n * (5 + n * 5)] < -1, "deep inside is negative");
  assert.ok(s[0 + n * (5 + n * 5)] > 1, "outside is positive");
});

test("blur3 keeps the total of a field away from the edges", () => {
  const n = 10, f = new Float32Array(n ** 3); f[5 + n * (5 + n * 5)] = 1;
  blur3(f, n, n, n, false);
  assert.ok(Math.abs(f.reduce((a, b) => a + b, 0) - 1) < 1e-6);
});

test("holdVolume keeps about the target number of cells above 0.5", () => {
  const r = rnd(3), f = Float32Array.from({ length: 5000 }, () => r());
  holdVolume(f, 1200);
  const above = f.reduce((a, v) => a + (v > 0.5 ? 1 : 0), 0);
  assert.ok(Math.abs(above - 1200) < 20, `${above} cells above 0.5`);
});

test("flood: a wall stops it, a hole lets it through", () => {
  const nx = 5, ny = 1, nz = 1, open = Uint8Array.from([1, 1, 0, 1, 1]);
  const A = (c) => c === 0, B = (c) => c === 4;
  assert.equal(flood(open, A, nx, ny, nz, B).stopped, false);
  assert.deepEqual([...flood(open, A, nx, ny, nz).seen], [1, 1, 0, 0, 0]);
  open[2] = 1;
  assert.equal(flood(open, A, nx, ny, nz, B).stopped, true);
});
