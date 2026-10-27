// Solver and optimizer: the same checks as the in-app self-test (Advanced mode in stage 3), run automatically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selfTest, createFem, hexKe } from "../src/geom/fem.js";
import { createMultigrid } from "../src/geom/multigrid.js";
import { amSelfTest, refineSelfTest } from "../src/geom/optimizer.js";

const tc = JSON.parse(readFileSync(new URL("../data/toolConnect.json", import.meta.url), "utf8"));
const check = (results) => results.forEach((r) => assert.ok(r.ok, r.text));

test("FEM: rigid movement, straight pull, energy, cantilever", () => check(selfTest([tc.cantileverRatio.min, tc.cantileverRatio.max])));
test("print filter: slopes and overhang rule", () => check(amSelfTest(tc.printReady.smoothMaxPower, tc.printReady.smoothMinEps)));
// a block with a hole and mixed densities, held at x = 0, pulled down at x = nx
function problem(nx, ny, nz, mg) {
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const nel = nx * ny * nz, active = new Uint8Array(nel), rho = new Float64Array(nel);
  for (let e = 0; e < nel; e++) { const i = e % nx, k = Math.floor(e / (nx * ny)); active[e] = Math.hypot(i - nx / 2, k - nz / 2) < Math.min(nx, nz) / 4 ? 0 : 1; rho[e] = rnd() < 0.3 ? 0.001 : 0.3 + 0.7 * rnd(); }
  const fem = createFem({ nx, ny, nz, active, Emin: 1e-3, p: 3, mg }), sx = nx + 1, sy = ny + 1, fx = new Uint8Array(fem.ndof), f = new Float64Array(fem.ndof);
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) { const n0 = sx * (j + sy * k); for (let d = 0; d < 3; d++) fx[3 * n0 + d] = 1; f[3 * (n0 + nx) + 2] = -1 / ((ny + 1) * (nz + 1)); }
  fem.setFixed(fx); fem.setDensity(rho);
  return { fem, f };
}
test("multigrid: same answer as Jacobi in far fewer steps", () => {
  const solve = (mg) => { const { fem, f } = problem(16, 8, 20, mg), u = new Float64Array(fem.ndof), s = fem.solve(f, u, 1e-8, 5000); let c = 0; for (let d = 0; d < fem.ndof; d++) c += f[d] * u[d]; return { s, c }; };
  const j = solve(null), m = solve(tc.solver.multigrid);
  assert.ok(Math.abs(j.c - m.c) / j.c < 1e-6, `compliance ${m.c} vs ${j.c}`);
  assert.ok(m.s.iters * 5 < j.s.iters, `${m.s.iters} multigrid steps vs ${j.s.iters} Jacobi steps`);
});
test("multigrid: coarse stiffness = Pᵀ K P, and the preconditioner is symmetric", () => {
  const nx = 6, ny = 4, nz = 5, nel = nx * ny * nz, Ke = hexKe(), sx = nx + 1, sy = ny + 1, sz = sx * sy, ndof = 3 * sz * (nz + 1);
  const off = [0, 1, 1 + sx, sx, sz, sz + 1, sz + 1 + sx, sz + sx], elems = Int32Array.from({ length: nel }, (_, e) => e);
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const Ee = Float64Array.from({ length: nel }, () => 0.1 + rnd()), fixed = new Uint8Array(ndof);
  const mv = (x, y) => { y.fill(0); for (const e of elems) { const i = e % nx, j = Math.floor(e / nx) % ny, k = Math.floor(e / (nx * ny)), n0 = i + sx * j + sz * k;
    for (let a = 0; a < 24; a++) { let s = 0; for (let b = 0; b < 24; b++) s += Ke[24 * a + b] * x[3 * (n0 + off[b / 3 | 0]) + b % 3]; y[3 * (n0 + off[a / 3 | 0]) + a % 3] += Ee[e] * s; } } };
  const diag = new Float64Array(ndof); for (const e of elems) { const i = e % nx, j = Math.floor(e / nx) % ny, k = Math.floor(e / (nx * ny)), n0 = i + sx * j + sz * k; for (let a = 0; a < 24; a++) diag[3 * (n0 + off[a / 3 | 0]) + a % 3] += Ee[e] * Ke[25 * a]; }
  const mg = createMultigrid({ nx, ny, nz, elems, Ke, o: { ...tc.solver.multigrid, directMaxDofs: 50 }, fine: { mv, invDiag: diag.map((v) => 1 / v), fixed } });
  mg.update(Ee);
  const { levels, mv: lmv, transfer } = mg.parts;
  assert.ok(levels.length >= 3, `${levels.length} levels`);
  for (let l = 0; l + 1 < levels.length; l++) { // Pᵀ K P x computed the long way equals the coarse level product
    const F = levels[l], C = levels[l + 1], xc = Float64Array.from({ length: C.ndof }, () => rnd() - 0.5), xf = new Float64Array(F.ndof), yf = new Float64Array(F.ndof), a = new Float64Array(C.ndof), b = new Float64Array(C.ndof);
    transfer(l, xf, xc, true); lmv(l, xf, yf); transfer(l, yf, a, false); lmv(l + 1, xc, b);
    for (let d = 0; d < C.ndof; d++) assert.ok(Math.abs(a[d] - b[d]) < 1e-9 * (1 + Math.abs(a[d])), `level ${l + 1} dof ${d}`);
  }
  const r1 = Float64Array.from({ length: ndof }, () => rnd() - 0.5), r2 = Float64Array.from({ length: ndof }, () => rnd() - 0.5), z1 = new Float64Array(ndof), z2 = new Float64Array(ndof);
  // symmetry needs held nodes (a free block can float, so its stiffness is singular): hold the x = 0 face
  fixed.fill(0); for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let d = 0; d < 3; d++) fixed[3 * (sx * (j + sy * k)) + d] = 1;
  const mv0 = mv, held = (x, y) => { mv0(x, y); for (let d = 0; d < ndof; d++) if (fixed[d]) y[d] = 0; };
  const mg2 = createMultigrid({ nx, ny, nz, elems, Ke, o: { ...tc.solver.multigrid, directMaxDofs: 50 }, fine: { mv: held, invDiag: diag.map((v, d) => (fixed[d] ? 0 : 1 / v)), fixed } });
  mg2.update(Ee); r1.forEach((_, d) => { if (fixed[d]) r1[d] = r2[d] = 0; });
  mg2.apply(r1, z1); mg2.apply(r2, z2);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  assert.ok(Math.abs(dot(r2, z1) - dot(r1, z2)) < 1e-9 * Math.abs(dot(r1, z1)), "symmetric");
  assert.ok(dot(r1, z1) > 0, "positive");
});
test("optimizer: pieces joined only at an edge, or not at all, are left out (free hinge, no NaN)", async () => {
  // a beam held at x = 0, plus a cube that touches the beam only at an edge and a two-cube piece that touches nothing
  const nx = 12, ny = 6, nz = 6, nel = nx * ny * nz, at = (i, j, k) => i + nx * (j + ny * k), sx = nx + 1, sy = ny + 1;
  const beam = new Uint8Array(nel); for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < nx; i++) beam[at(i, j, k)] = 1;
  const active = beam.slice(); active[at(5, 2, 2)] = 1; active[at(9, 3, 2)] = 1; active[at(10, 3, 2)] = 1;
  const fixedMask = new Uint8Array(3 * sx * sy * (nz + 1)), force = new Float64Array(fixedMask.length);
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let d = 0; d < 3; d++) fixedMask[3 * (sx * (j + sy * k)) + d] = 1;
  for (let k = 0; k <= 2; k++) for (let j = 0; j <= 2; j++) force[3 * (nx + sx * (j + sy * k)) + 2] = -1 / 9;
  const { faceJoined, optimize } = await import("../src/geom/optimizer.js");
  assert.deepEqual(faceJoined(nx, ny, nz, active, fixedMask), beam);
  const solver = { ...tc.solver, multigrid: { ...tc.solver.multigrid, directMaxDofs: 50 } }, run = (a) => optimize({ nx, ny, nz, active: a, passive: new Uint8Array(nel), fixedMask, force, vf: 0.5, rmin: 1.5, maxIter: 3, solver }, () => {}, () => false);
  const a = await run(active), b = await run(beam);
  assert.ok(Number.isFinite(a.c) && a.c > 0, `compliance ${a.c}`);
  assert.ok(Math.abs(a.c - b.c) < 1e-9 * b.c, `with loose pieces ${a.c}, beam only ${b.c}`);
});
test("solve check: NaN, negative or absurd results give a warning, normal ones do not", async () => {
  const { solveCheck } = await import("../src/geom/solveCheck.js"), max = tc.maxSagMm.default;
  assert.equal(solveCheck({ c: 13.4, c0: 13.4, sag: 0.04 }, max), null);
  assert.equal(solveCheck({ c: 8.8, c0: 13.4 }, max), null); // progress steps have no sag
  for (const m of [{ c: NaN, c0: NaN }, { c: -1.8e11, c0: -1.8e11, sag: -3.6e9 }, { c: 15, c0: 93, sag: 24305379 }, { c: 15, c0: 93, sag: NaN }, { c: Infinity, c0: 1 }])
    assert.ok(solveCheck(m, max), JSON.stringify(m));
});
test("refine rule: material cap and stiffness tolerance", async () => {
  const r = tc.refine;
  check(await refineSelfTest(r.stiffnessTolerance.default, r.shrinkStep.default, r.minVolumeFraction.default, tc.solver));
});
