// Topology optimization: SIMP material model, density filter, optimality-criteria update.
// Minimizes compliance (maximizes stiffness) with a cap on the amount of material.
import { createFem } from "./fem.js";

// P: nx, ny, nz, active (1 = element exists), passive (1 = fixed solid), fixedMask, force, vf (material fraction), rmin (filter radius in voxels), maxIter.
// Refine only: x0 = start density per element (instead of vf). shrink = {tol, step, minFrac}: once the design settles, the material cap is lowered
// by "step" while the stiffness stays within "tol" of the start design (compliance of the first step), down to minFrac of the first cap.
// Print-ready only: am = {base (1 = cell rests on the bed), P, eps, start}: the additive manufacturing filter below is applied after the density filter.
// solver: data/toolConnect.json "solver" block (penalty, minStiffness, moveLimit, stopChange, minSteps, shrinkSettleSteps, firstStep, laterSteps).
// onStep(info) may be async (lets the worker receive Stop). shouldStop() -> true to stop.
export async function optimize(P, onStep, shouldStop) {
  const { nx, ny, nz, active, passive, fixedMask, force, vf, rmin, maxIter, x0, shrink, am, solver: sv } = P;
  const p = sv.penalty, Emin = sv.minStiffness, move = sv.moveLimit, nel = nx * ny * nz;
  const fem = createFem({ nx, ny, nz, active, Emin, p, mg: sv.multigrid });
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
  // a grey start fades out layer by layer under the print filter, so it starts at am.start (the OC update brings the material down to the cap)
  for (let e = 0; e < nel; e++) x[e] = passive[e] ? 1 : active[e] ? (x0 ? x0[e] : am ? Math.max(vf, am.start) : vf) : 0;
  const amF = am ? createAm({ nx, ny, nz, active, passive, base: am.base, P: am.P, eps: am.eps }) : null;
  const xi = amF ? new Float64Array(nel) : null, phys = xi || rho; // phys = the density the solver sees (the printed density in print-ready mode)
  const filter = () => {
    rho.set(x);
    for (let r = 0; r < nFree; r++) { let s = 0; for (let o = rowStart[r]; o < rowStart[r + 1]; o++) s += w[o] * x[cols[o]]; rho[list[r]] = s / sRow[r]; }
    if (amF) amF.forward(rho, xi);
  };
  const u = new Float64Array(fem.ndof), ue = new Float64Array(nel), dc = new Float64Array(nFree), dcdx = new Float64Array(nFree), xn = new Float64Array(nFree);
  const Vcap = vf * nFree;
  let Vt = Vcap, cRef = null, accepted = null, accC = 0, accVol = 0, since = 0;
  let c0 = null, c = 0, steps = 0, change = 1, vol = vf, stopped = false, converged = false;
  filter();
  for (let it = 1; it <= maxIter; it++) {
    if (shouldStop()) { stopped = true; break; }
    fem.setDensity(phys);
    const cg = it === 1 ? sv.firstStep : sv.laterSteps, s = fem.solve(force, u, cg.tolerance, cg.maxCgIterations);
    fem.unitEnergy(u, ue);
    c = 0; for (let d = 0; d < fem.ndof; d++) c += force[d] * u[d];
    if (c0 === null) c0 = cRef = c;
    for (let r = 0; r < nFree; r++) { const e = list[r]; dc[r] = -p * (1 - Emin) * Math.pow(phys[e], p - 1) * ue[e]; }
    if (amF) amF.chain(list, dc);
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
    await onStep({ it, maxIter, c, c0, vol, change, cg: s.iters, rho: phys });
    since++;
    if (change < sv.stopChange && it >= sv.minSteps && (!shrink || since >= sv.shrinkSettleSteps)) {
      if (shrink && c <= cRef * (1 + shrink.tol) && Vt * (1 - shrink.step) >= Vcap * shrink.minFrac) {
        accepted = Float64Array.from(x); accC = c; accVol = vol; Vt *= 1 - shrink.step; since = 0; continue;
      }
      converged = true; break;
    }
  }
  if (shrink && accepted && c > cRef * (1 + shrink.tol)) { x.set(accepted); filter(); c = accC; vol = accVol; } // the last shrink cost too much stiffness: go back
  return { rho: phys, c, c0: c0 ?? c, cRef: cRef ?? c, vol, it: steps, stopped, converged };
}
// Additive manufacturing filter (written from Langelaar 2017, "An additive manufacturing filter for topology optimization of print-ready designs").
// Build direction +Z. A cell can only be as solid as the cells that hold it up: the cell straight below and its 4 side neighbours one layer down
// (= 45° overhang). printed = smin(design, smax(printed supports)). Cells on the bed are always held up. Passive cells are solid, inactive cells empty.
function createAm({ nx, ny, nz, active, passive, base, P, eps }) {
  const nel = nx * ny * nz, L = nx * ny, se = Math.sqrt(eps), ln05 = Math.log(0.5);
  const a = new Float64Array(nel), b = new Float64Array(nel), sp = new Float64Array(nel), q = new Float64Array(nel), g = new Float64Array(nel);
  let xi = null;
  const sup = (e, fn) => { const k = Math.floor(e / L); if (k === 0) return; const i = e % nx, j = Math.floor(e / nx) % ny, d = e - L;
    fn(d); if (i > 0) fn(d - 1); if (i < nx - 1) fn(d + 1); if (j > 0) fn(d - nx); if (j < ny - 1) fn(d + nx); };
  const free = (e) => active[e] && !passive[e];
  // cells are stored x fastest, then y, then z, so every cell of layer k-1 is done before layer k
  function forward(rho, out) {
    xi = out;
    for (let e = 0; e < nel; e++) {
      sp[e] = 0;
      if (!active[e]) { xi[e] = 0; continue; }
      if (passive[e]) { xi[e] = 1; continue; }
      if (base[e]) { xi[e] = rho[e]; a[e] = 1; b[e] = 0; continue; }
      let s = 0, n = 0; sup(e, (f) => { s += Math.pow(xi[f], P); n++; });
      const Q = P + (n ? Math.log(n) / ln05 : 0); // smax is exact when every support is 0.5
      const X = n && s > 1e-200 ? Math.pow(s, 1 / Q) : 0, d = rho[e] - X, r = Math.sqrt(d * d + eps);
      xi[e] = 0.5 * (rho[e] + X - r + se); a[e] = 0.5 * (1 - d / r); b[e] = 0.5 * (1 + d / r); sp[e] = X ? s : 0; q[e] = Q;
    }
  }
  // dc = d(compliance)/d(printed) per free row; turned into d(compliance)/d(design), top layer down (adjoint sweep)
  function chain(list, dc) {
    for (let r = 0; r < list.length; r++) g[list[r]] = dc[r];
    for (let e = nel - 1; e >= 0; e--) {
      if (!free(e)) continue;
      if (sp[e] > 0) { const mu = g[e] * b[e] * (P / q[e]) * Math.pow(sp[e], 1 / q[e] - 1); sup(e, (f) => { if (free(f)) g[f] += mu * Math.pow(xi[f], P - 1); }); }
      g[e] *= a[e];
    }
    for (let r = 0; r < list.length; r++) dc[r] = g[list[r]];
  }
  return { forward, chain };
}

// Print filter self-test: the filter slopes match a numerical check, and material above an empty layer is not printed.
export function amSelfTest(P, eps) {
  const nx = 3, ny = 3, nz = 4, nel = nx * ny * nz, active = new Uint8Array(nel).fill(1), passive = new Uint8Array(nel), base = new Uint8Array(nel);
  for (let e = 0; e < nx * ny; e++) base[e] = 1;
  const am = createAm({ nx, ny, nz, active, passive, base, P, eps }), rho = Float64Array.from({ length: nel }, (_, e) => 0.3 + 0.6 * Math.abs(Math.sin(e * 1.7)));
  const wt = Float64Array.from({ length: nel }, (_, e) => 1 + (e % 5)), J = (r) => { const t = new Float64Array(nel); am.forward(r, t); return t.reduce((s, v, e) => s + wt[e] * v * v, 0); };
  const xi = new Float64Array(nel); am.forward(rho, xi);
  const list = [...Array(nel).keys()], dc = Float64Array.from(list, (e) => 2 * wt[e] * xi[e]); am.chain(list, dc);
  let err = 0;
  for (const e of [0, 10, 13, 22, 31]) { const r1 = Float64Array.from(rho), r2 = Float64Array.from(rho); r1[e] += 1e-6; r2[e] -= 1e-6; const fd = (J(r1) - J(r2)) / 2e-6; err = Math.max(err, Math.abs(fd - dc[e]) / Math.max(1e-9, Math.abs(fd))); }
  const hang = new Float64Array(nel).fill(1); for (let e = nx * ny; e < 2 * nx * ny; e++) hang[e] = 0; // layer 1 empty: layers 2 and 3 have nothing below
  const xh = new Float64Array(nel); am.forward(hang, xh);
  const top = Math.max(...xh.slice(2 * nx * ny));
  return [
    { ok: err < 1e-4, text: `Print filter: slopes match a numerical check (error ${err.toExponential(1)})` },
    { ok: top < 0.05, text: `Print filter: material above an empty layer is not printed (max ${top.toFixed(3)})` },
  ];
}

// Refine self-test: a small cantilever is optimized, then re-run from its own result with the shrink rule.
// Checks: the material never goes above the cap, and the stiffness stays within the tolerance of the start design.
export async function refineSelfTest(tol, step, minFrac, solver) {
  const nx = 16, ny = 5, nz = 5, nel = nx * ny * nz, sx = nx + 1, sy = ny + 1, nn = sx * sy * (nz + 1);
  const fixedMask = new Uint8Array(3 * nn), force = new Float64Array(3 * nn);
  for (let j = 0; j <= ny; j++) for (let k = 0; k <= nz; k++) {
    for (let d = 0; d < 3; d++) fixedMask[3 * (0 + sx * (j + sy * k)) + d] = 1;
    force[3 * (nx + sx * (j + sy * k)) + 2] = -1 / ((ny + 1) * (nz + 1));
  }
  const base = { nx, ny, nz, active: new Uint8Array(nel).fill(1), passive: new Uint8Array(nel), fixedMask, force, vf: 0.4, rmin: 1.5, maxIter: 80, solver };
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
