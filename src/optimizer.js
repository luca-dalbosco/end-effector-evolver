// Topology optimization: SIMP material model, density filter, optimality-criteria update.
// Minimizes compliance (maximizes stiffness) with a cap on the amount of material.
import { createFem } from "./fem.js";

// P: nx, ny, nz, active (1 = element exists), passive (1 = fixed solid), fixedMask, force, vf (material fraction), rmin (filter radius in voxels), maxIter.
// Refine only: x0 = start density per element (instead of vf). shrink = {tol, step, minFrac}: once the design settles, the material cap is lowered
// by "step" while the stiffness stays within "tol" of the start design (compliance of the first step), down to minFrac of the first cap.
// onStep(info) may be async (lets the worker receive Stop). shouldStop() -> true to stop.
export async function optimize(P, onStep, shouldStop) {
  const { nx, ny, nz, active, passive, fixedMask, force, vf, rmin, maxIter, x0, shrink } = P;
  const p = 3, Emin = 1e-3, move = 0.3, nel = nx * ny * nz;
  const fem = createFem({ nx, ny, nz, active, Emin, p });
  fem.setFixed(fixedMask);

  const rowOf = new Int32Array(nel).fill(-1), list = [];
  for (let e = 0; e < nel; e++) if (active[e] && !passive[e]) { rowOf[e] = list.length; list.push(e); }
  const nFree = list.length;
  if (!nFree) throw new Error("Nothing to optimize: the design space is empty.");

  // Density filter: each free element averages the densities of neighbours closer than rmin (CSR lists).
  const R = Math.ceil(rmin), rowStart = new Int32Array(nFree + 1);
  const visit = (e, fn) => {
    const i = e % nx, j = Math.floor(e / nx) % ny, k = Math.floor(e / (nx * ny));
    for (let dk = -R; dk <= R; dk++) { const K = k + dk; if (K < 0 || K >= nz) continue;
      for (let dj = -R; dj <= R; dj++) { const J = j + dj; if (J < 0 || J >= ny) continue;
        for (let di = -R; di <= R; di++) { const I = i + di; if (I < 0 || I >= nx) continue;
          const f = I + nx * (J + ny * K); if (!active[f]) continue;
          const d = Math.hypot(di, dj, dk); if (d < rmin) fn(f, rmin - d); } } }
  };
  for (let r = 0; r < nFree; r++) { let n = 0; visit(list[r], () => n++); rowStart[r + 1] = rowStart[r] + n; }
  const cols = new Int32Array(rowStart[nFree]), w = new Float32Array(rowStart[nFree]), sRow = new Float64Array(nFree);
  for (let r = 0; r < nFree; r++) { let o = rowStart[r], s = 0; visit(list[r], (f, wt) => { cols[o] = f; w[o++] = wt; s += wt; }); sRow[r] = s; }

  // Material amount is linear in the design variables: V = vConst + sum(dv * x).
  const dv = new Float64Array(nFree); let vConst = 0;
  for (let r = 0; r < nFree; r++) for (let o = rowStart[r]; o < rowStart[r + 1]; o++) {
    const fr = rowOf[cols[o]], a = w[o] / sRow[r]; if (fr >= 0) dv[fr] += a; else vConst += a;
  }

  const x = new Float64Array(nel), rho = new Float64Array(nel);
  for (let e = 0; e < nel; e++) x[e] = passive[e] ? 1 : active[e] ? (x0 ? x0[e] : vf) : 0;
  const filter = () => {
    rho.set(x);
    for (let r = 0; r < nFree; r++) { let s = 0; for (let o = rowStart[r]; o < rowStart[r + 1]; o++) s += w[o] * x[cols[o]]; rho[list[r]] = s / sRow[r]; }
  };
  const u = new Float64Array(fem.ndof), ue = new Float64Array(nel), dc = new Float64Array(nFree), dcdx = new Float64Array(nFree), xn = new Float64Array(nFree);
  const Vcap = vf * nFree;
  let Vt = Vcap, cRef = null, accepted = null, accC = 0, accVol = 0, since = 0;
  let c0 = null, c = 0, steps = 0, change = 1, vol = vf, stopped = false, converged = false;
  filter();
  for (let it = 1; it <= maxIter; it++) {
    if (shouldStop()) { stopped = true; break; }
    fem.setDensity(rho);
    const s = fem.solve(force, u, it === 1 ? 1e-4 : 1e-3, it === 1 ? 500 : 60);
    fem.unitEnergy(u, ue);
    c = 0; for (let d = 0; d < fem.ndof; d++) c += force[d] * u[d];
    if (c0 === null) c0 = cRef = c;
    for (let r = 0; r < nFree; r++) { const e = list[r]; dc[r] = -p * (1 - Emin) * Math.pow(rho[e], p - 1) * ue[e]; }
    dcdx.fill(0);
    for (let r = 0; r < nFree; r++) for (let o = rowStart[r]; o < rowStart[r + 1]; o++) { const fr = rowOf[cols[o]]; if (fr >= 0) dcdx[fr] += (w[o] / sRow[r]) * dc[r]; }
    let l1 = 0, l2 = 1e9, guard = 0;
    while (l2 - l1 > 1e-4 * (l1 + l2) && guard++ < 200) {
      const lm = 0.5 * (l1 + l2); let v = vConst;
      for (let r = 0; r < nFree; r++) {
        const xr = x[list[r]]; let q = xr * Math.sqrt(Math.max(1e-30, -dcdx[r] / dv[r] / lm));
        q = Math.min(xr + move, Math.max(xr - move, q)); xn[r] = Math.min(1, Math.max(0, q)); v += dv[r] * xn[r];
      }
      if (v > Vt) l1 = lm; else l2 = lm;
    }
    change = 0; for (let r = 0; r < nFree; r++) { const e = list[r]; change = Math.max(change, Math.abs(xn[r] - x[e])); x[e] = xn[r]; }
    vol = vConst; for (let r = 0; r < nFree; r++) vol += dv[r] * x[list[r]]; vol /= nFree;
    filter(); steps = it;
    await onStep({ it, maxIter, c, c0, vol, change, cg: s.iters, rho });
    since++;
    if (change < 0.02 && it >= 12 && (!shrink || since >= 8)) {
      if (shrink && c <= cRef * (1 + shrink.tol) && Vt * (1 - shrink.step) >= Vcap * shrink.minFrac) {
        accepted = Float64Array.from(x); accC = c; accVol = vol; Vt *= 1 - shrink.step; since = 0; continue;
      }
      converged = true; break;
    }
  }
  if (shrink && accepted && c > cRef * (1 + shrink.tol)) { x.set(accepted); filter(); c = accC; vol = accVol; } // the last shrink cost too much stiffness: go back
  return { rho, c, c0: c0 ?? c, cRef: cRef ?? c, vol, it: steps, stopped, converged };
}
// Refine self-test: a small cantilever is optimized, then re-run from its own result with the shrink rule.
// Checks: the material never goes above the cap, and the stiffness stays within the tolerance of the start design.
export async function refineSelfTest(tol, step, minFrac) {
  const nx = 16, ny = 5, nz = 5, nel = nx * ny * nz, sx = nx + 1, sy = ny + 1, nn = sx * sy * (nz + 1);
  const fixedMask = new Uint8Array(3 * nn), force = new Float64Array(3 * nn);
  for (let j = 0; j <= ny; j++) for (let k = 0; k <= nz; k++) {
    for (let d = 0; d < 3; d++) fixedMask[3 * (0 + sx * (j + sy * k)) + d] = 1;
    force[3 * (nx + sx * (j + sy * k)) + 2] = -1 / ((ny + 1) * (nz + 1));
  }
  const base = { nx, ny, nz, active: new Uint8Array(nel).fill(1), passive: new Uint8Array(nel), fixedMask, force, vf: 0.4, rmin: 1.5, maxIter: 80 };
  const noop = () => {}, never = () => false;
  const a = await optimize(base, noop, never);
  const x0 = new Float64Array(nel); for (let e = 0; e < nel; e++) x0[e] = a.rho[e] > 0.5 ? 1 : 0.01;
  const cap = x0.reduce((s, v) => s + (v === 1 ? 1 : 0), 0) / nel; // as in the app: the cap is the volume of the start design
  const b = await optimize({ ...base, vf: cap, x0, maxIter: 150, shrink: { tol, step, minFrac } }, noop, never);
  const lim = b.cRef * (1 + tol);
  return [
    { ok: b.vol <= cap + 1e-3, text: `Refine rule: material ${(b.vol * 100).toFixed(1)}% never above the start volume of ${(cap * 100).toFixed(1)}%` },
    { ok: b.c <= lim * (1 + 1e-6), text: `Refine rule: stiffness ${(b.cRef / b.c).toFixed(2)}× the start design (needs ≥ ${(1 / (1 + tol)).toFixed(2)}×), material cut from ${(cap * 100).toFixed(1)}% to ${(b.vol * 100).toFixed(1)}%` },
  ];
}
