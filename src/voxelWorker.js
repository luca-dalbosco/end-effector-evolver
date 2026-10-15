// Stage C worker: answers the stage 3 panel. Holds the current voxel design (state) between requests.
// The maths lives in src/geom/ (pure functions); this file wires it together. Units: mm.
import { createFem, selfTest } from "./geom/fem.js";
import { optimize, refineSelfTest, amSelfTest } from "./geom/optimizer.js";
import { voxelizeSolid, solidCentroid, nodalLoads } from "./geom/voxelize.js";
import { BIG, edt, blur3, holdVolume, signedDist, flood } from "./geom/grid.js";
import { exposed, surfaceNets } from "./geom/mesh.js";
import { samplePoints } from "./geom/tri.js";
import { avoidMask, bedLayer, slotDist, keepOutMask, overhangs } from "./geom/keepout.js";
import { bridge } from "./geom/bridge.js";
import { loadVector } from "./geom/load.js";
import { replyTo, meshBufs } from "./rpc.js";
import tc from "../data/toolConnect.json";
const tcRefine = Object.fromEntries(Object.entries(tc.refine).map(([k, v]) => [k, v.default]));

// Speed test: seconds per element for one real solver matrix-vector product.
function bench() {
  const fem = createFem({ nx: 12, ny: 12, nz: 12 }), x = Float64Array.from({ length: fem.ndof }, (_, i) => Math.sin(i)), y = new Float64Array(fem.ndof);
  fem.setDensity(new Float64Array(fem.nel).fill(1));
  for (let r = 0; r < 20; r++) fem.matvec(x, y); // warm-up so the speed test is not pessimistic
  const t0 = performance.now();
  for (let r = 0; r < 20; r++) fem.matvec(x, y);
  return (performance.now() - t0) / 1000 / (20 * fem.nel);
}

// Clearance zones: every red item with its own gap (mm grow / mm out), plus the tool start, Flange Clearance and Bolt Clearance.
// "ring" = the cells the gaps add around the items (the ghost shell). Kept in the state until the grid changes.
function clearZones() {
  const S = state; if (S.zones) return S.zones;
  const { nx, ny, nz, h, org } = S, N = nx * ny * nz, blocked = new Uint8Array(N), ring = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (S.fixed[c]) blocked[c] = 1;
  for (const it of S.avoid) {
    const zone = avoidMask([it], nx, ny, nz, org, h), base = it.mm > 0 ? avoidMask([{ ...it, mm: 0 }], nx, ny, nz, org, h) : zone;
    for (let c = 0; c < N; c++) if (zone[c]) { blocked[c] = 1; if (!base[c]) ring[c] = 1; }
  }
  return (S.zones = { blocked, ring });
}

// Cells of mask (1/0) attached to a connect surface through face neighbours, and whether the robot side reaches the tool end.
function reach(mask, S) {
  const { nx, ny, nz } = S, { seen } = flood(mask, (c) => S.srcA[c] || S.srcB[c], nx, ny, nz);
  return { seen, reachedB: flood(mask, (c) => S.srcA[c], nx, ny, nz, (c) => S.srcB[c]).stopped };
}

// Deletes result voxels inside the zones (connect surfaces are kept), then drops pieces no longer attached to a connect surface.
function clearance() {
  const S = state, { nx, ny, nz, h, org } = S, N = nx * ny * nz;
  if (!S.result) throw new Error("Generate a design first.");
  const { blocked } = clearZones(), mask = new Uint8Array(N);
  let before = 0, cut = 0;
  for (let c = 0; c < N; c++) if (S.active[c] && S.result[c] > 0.5) { before++; if (blocked[c] && !S.srcA[c] && !S.srcB[c]) cut++; else mask[c] = 1; }
  const { seen, reachedB } = reach(mask, S);
  let islands = 0; for (let c = 0; c < N; c++) if (mask[c] && !seen[c]) { mask[c] = 0; islands++; }
  S.cleared = mask; S.smooth = null;
  const after = before - cut - islands;
  return { mesh: exposed(mask, nx, ny, nz, h, org), stats: { before, cut, islands, after, connected: reachedB, volCm3: (after * h ** 3) / 1000, overhang: overhangs(mask, S, S.input.keepOut) } };
}

// ---------- Smoothing ----------
// Smooth field: 0..1 per cell, 0.5 = the surface. Starts as the cleared voxels. Each pass blurs it, keeps the volume and pins the connect surfaces.
function smoothField(S) { // made on the first use after a Generate, Clearance or Refine
  if (!S.result) throw new Error("Generate a design first.");
  if (!S.smooth) { const mk = S.cleared || coarseMask(S), f = new Float32Array(mk.length); for (let c = 0; c < f.length; c++) f[c] = mk[c]; S.smooth = { f }; }
  return S.smooth.f;
}

// Drops smooth material that no longer touches a connect surface (value to 0). Returns the loose cell count and the connection state.
function smoothIslands(S, f) {
  const m = new Uint8Array(f.length); for (let c = 0; c < f.length; c++) if (f[c] > 0.5) m[c] = 1;
  const { seen, reachedB } = reach(m, S); let islands = 0;
  for (let c = 0; c < f.length; c++) if (m[c] && !seen[c]) { f[c] = 0; islands++; }
  return { islands, connected: reachedB };
}

function smoothReply(S, f, extra) {
  let cells = 0; for (let c = 0; c < f.length; c++) if (f[c] > 0.5) cells++;
  const mesh = surfaceNets(f, S.nx, S.ny, S.nz, S.h, S.org);
  return { mesh, stats: { volCm3: (cells * S.h ** 3) / 1000, tris: mesh.i.length / 3, ...extra } };
}

// One smoothing click: `passes` blurs, same volume, connect surfaces stay put.
function smoothing(passes) {
  const S = state, f = smoothField(S);
  let before = 0; for (let c = 0; c < f.length; c++) if (f[c] > 0.5) before++;
  for (let r = 0; r < passes; r++) blur3(f, S.nx, S.ny, S.nz, false);
  holdVolume(f, before);
  for (let c = 0; c < f.length; c++) if (S.srcA[c] || S.srcB[c]) f[c] = 1;
  return smoothReply(S, f, smoothIslands(S, f));
}

// Boolean difference: cuts the smooth shape with the clearance zones (signed distance to the zones, a little rounded). Connect surfaces stay.
function smoothClearance() {
  const S = state, f = smoothField(S), N = f.length;
  const d = signedDist(clearZones().blocked, S.nx, S.ny, S.nz); // in voxels, positive outside the zones, zero on the zone surface
  let cut = 0;
  for (let c = 0; c < N; c++) {
    if (S.srcA[c] || S.srcB[c]) continue;
    const lim = Math.min(0.5, Math.max(-0.5, 0.25 * d[c])) + 0.5; // 0.5 on the zone surface, a 4 voxel ramp
    if (f[c] > lim) { if (f[c] > 0.5 && lim <= 0.5) cut++; f[c] = lim; }
  }
  return smoothReply(S, f, { cut, ...smoothIslands(S, f) });
}

// Refine: for a new (finer) grid, which cells lie inside the coarse material (mat) and which within bandMm of it (band).
function refineMasks(r, nx, ny, nz, org, h) {
  const { nx: cx, ny: cy, nz: cz, h: ch, org: co, mask, bandMm } = r, f = new Float32Array(cx * cy * cz);
  for (let c = 0; c < f.length; c++) f[c] = mask[c] ? 0 : BIG;
  edt(f, cx, cy, cz);
  const lim = (bandMm / ch) ** 2, band = new Uint8Array(nx * ny * nz), mat = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    const k = Math.floor((org[2] + (z + 0.5) * h - co[2]) / ch); if (k < 0 || k >= cz) continue;
    for (let y = 0; y < ny; y++) {
      const j = Math.floor((org[1] + (y + 0.5) * h - co[1]) / ch); if (j < 0 || j >= cy) continue;
      for (let x = 0; x < nx; x++) {
        const i = Math.floor((org[0] + (x + 0.5) * h - co[0]) / ch); if (i < 0 || i >= cx) continue;
        const c = i + cx * (j + cy * k), o = x + nx * (y + ny * z);
        if (mask[c]) mat[o] = 1;
        if (f[c] <= lim) band[o] = 1;
      }
    }
  }
  return { band, mat };
}

let state = null, running = false, stopFlag = false, levels = {}; // levels: refined states by level id (Normal, Fine)

// Design space: the cells between the two connect surfaces (within the band), minus the solids and the keep-outs.
function compute(m) {
  let h = m.h;
  let A = samplePoints(m.startTris, h, m.R); const bo = m.keepOut?.bolts;
  if (bo) { const keep = []; for (let i = 0; i < A.length; i += 3) if (!bo.some((b) => A[i + 2] >= b.z0 - h && A[i + 2] <= b.z1 && slotDist(b, A[i], A[i + 1]) <= b.r)) keep.push(A[i], A[i + 1], A[i + 2]); A = keep; }
  const B = samplePoints(m.endTris, h, null);
  if (!A.length) throw new Error("The robot side has no connect surface here. Try 'Entire top surface'.");
  if (!B.length) throw new Error("No tool face selected.");
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], ca = [0, 0, 0], cb = [0, 0, 0];
  for (const [P, c] of [[A, ca], [B, cb]]) for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); c[a] += P[i + a] / (P.length / 3);
  }
  const Lest = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
  const side = 0.5 * Math.sqrt((1 + m.band) ** 2 - 1) * Lest;
  const cog = solidCentroid(m.endAll);
  if (!m.restrict) { const vbox = [0, 1, 2].reduce((p, a) => p * (hi[a] - lo[a] + 2 * side), 1); h = Math.max(h, Math.cbrt(vbox / (m.budget * 4))); } // analysis voxel comes from the voxel limit: start near it so the first pass is cheap
  let retried = false;
  for (;;) {
    const pad = side + 2 * h, org = lo.map((v) => v - pad), dim = hi.map((v, a) => Math.ceil((v + pad - org[a]) / h) + 1);
    const [nx, ny, nz] = dim, N = nx * ny * nz;
    if (N > m.maxCells) { h *= Math.cbrt(N / m.maxCells) * 1.02; continue; }
    const srcA = new Uint8Array(N), srcB = new Uint8Array(N);
    const mark = (P, S) => { for (let i = 0; i < P.length; i += 3) {
      const x = Math.min(nx - 1, Math.max(0, Math.floor((P[i] - org[0]) / h))), y = Math.min(ny - 1, Math.max(0, Math.floor((P[i + 1] - org[1]) / h))), z = Math.min(nz - 1, Math.max(0, Math.floor((P[i + 2] - org[2]) / h)));
      S[x + nx * (y + ny * z)] = 1; } };
    mark(A, srcA); mark(B, srcB);
    const field = (S) => { const f = new Float32Array(N); for (let c = 0; c < N; c++) f[c] = S[c] ? 0 : BIG; edt(f, nx, ny, nz); return f; };
    const fA = field(srcA), fB = field(srcB);
    let best = Infinity;
    for (let c = 0; c < N; c++) { const s = Math.sqrt(fA[c]) + Math.sqrt(fB[c]); if (s < best) best = s; }
    if (best < 1) throw new Error("The robot side and the picked faces touch or overlap. Move the tool away from the robot side.");
    const thr = best * (1 + m.band);
    const kS = voxelizeSolid(m.startAll, nx, ny, nz, org, h), kE = voxelizeSolid(m.endAll, nx, ny, nz, org, h);
    const free = new Uint8Array(N), vis = new Uint8Array(N), uni = new Uint8Array(N), lost = new Uint8Array(N), av = m.avoid?.length ? avoidMask(m.avoid, nx, ny, nz, org, h) : null, ko = m.keepOut ? keepOutMask(m.keepOut, nx, ny, nz, org, h) : null;
    const rf = m.restrict ? refineMasks(m.restrict, nx, ny, nz, org, h) : null;
    let count = 0, nA = 0, nB = 0, nFree = 0, nAvoided = 0, avoidHitsSrc = false;
    for (let c = 0; c < N; c++) {
      if (srcA[c]) nA++; if (srcB[c]) nB++;
      if (srcA[c] || srcB[c]) { uni[c] = 1; vis[c] = 1; count++; if (av && av[c]) avoidHitsSrc = true; }
      else if (!kS[c] && !kE[c] && (!rf || rf.band[c]) && Math.sqrt(fA[c]) + Math.sqrt(fB[c]) <= thr) {
        if ((av && av[c]) || (ko && ko[c])) { lost[c] = 1; nAvoided++; continue; } // red: no voxel may grow here
        free[c] = 1; vis[c] = 1; count++; nFree++;
      }
    }
    if (!flood(vis, (c) => srcA[c], nx, ny, nz, (c) => srcB[c]).stopped) throw new Error("The robot side, the tool or a red zone (including Flange Clearance) blocks the way between the surfaces. Make the red zones smaller (for example a lower robot offset) or increase the design space size." + (m.keepOut?.bed ? " Print-ready is on: nothing may grow below the flange face." : ""));
    if (count > m.budget * 1.1 && !retried) { retried = true; h *= Math.cbrt(count / m.budget) * 1.02; continue; }
    const fixed = new Uint8Array(N); for (let c = 0; c < N; c++) if (kS[c] || (ko && ko[c])) fixed[c] = 1;
    state = { nx, ny, nz, h, org, srcA, srcB, free, cog, fixed, avoid: m.avoid || [], input: m, mat: rf ? rf.mat : null };
    const stats = { h, dim, count, nFree, L: best * h, nA, nB, nAvoided, avoidHitsSrc, overBudget: count > m.budget * 1.1 };
    if (rf) return { stats }; // refine: no preview meshes
    levels = {}; // a new design space: no refined levels yet
    return { stats, dom: exposed(vis, nx, ny, nz, h, org), src: exposed(uni, nx, ny, nz, h, org), avoid: exposed(lost, nx, ny, nz, h, org) };
  }
}

async function runOptimize(m) {
  const S = state, { nx, ny, nz, h, org } = S, N = nx * ny * nz, sx = nx + 1, sy = ny + 1;
  const node = (i, j, k) => i + sx * (j + sy * k);
  const active = new Uint8Array(N), passive = new Uint8Array(N), fixedMask = new Uint8Array(3 * sx * sy * (nz + 1)), force = new Float64Array(fixedMask.length);
  const fixedNodes = new Set(), loadNodes = new Set();
  const corners = (c, fn) => { const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
    for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) fn(node(i + di, j + dj, k + dk)); };
  for (let c = 0; c < N; c++) {
    if (S.free[c] || S.srcA[c] || S.srcB[c]) active[c] = 1;
    if (S.srcA[c] || S.srcB[c]) passive[c] = 1;
    if (S.srcA[c]) corners(c, (n) => fixedNodes.add(n)); else if (S.srcB[c]) corners(c, (n) => loadNodes.add(n));
  }
  fixedNodes.forEach((n) => { fixedMask[3 * n] = fixedMask[3 * n + 1] = fixedMask[3 * n + 2] = 1; loadNodes.delete(n); });
  const ids = [...loadNodes], pos = new Float64Array(3 * ids.length);
  ids.forEach((n, q) => { pos[3 * q] = org[0] + (n % sx) * h; pos[3 * q + 1] = org[1] + (Math.floor(n / sx) % sy) * h; pos[3 * q + 2] = org[2] + Math.floor(n / (sx * sy)) * h; });
  const F = loadVector(m.gdir, m.mass, m.accel, m.extra);
  if (Math.hypot(...F) < 1e-9) throw new Error("The load is zero. Check payload mass and extra force.");
  const loads = nodalLoads(pos, F, S.cog);
  ids.forEach((n, q) => { for (let d = 0; d < 3; d++) force[3 * n + d] = loads[3 * q + d]; });
  // sag in mm: the solver works with E = 1, a voxel of 1 and a load scaled to 1 N (nodalLoads), the real stiffness is E × h,
  // so movement along the load = compliance × |F| / (E × h)
  const sag = (c) => (c * Math.hypot(...F)) / (tc.material.youngsModulusMPa * h);
  let am = null;
  const ko = S.input.keepOut;
  if (ko?.bed) { // print-ready: cells of the first layer rest on the bed
    const base = new Uint8Array(N), kb = bedLayer(ko, org, h);
    if (kb >= 0 && kb < nz) base.fill(1, nx * ny * kb, nx * ny * (kb + 1));
    am = { base, P: tc.printReady.smoothMaxPower, eps: tc.printReady.smoothMinEps, start: tc.printReady.startDensity };
  }

  const meshOf = (rho) => { const mask = new Uint8Array(N); for (let c = 0; c < N; c++) if (active[c] && rho[c] > 0.5) mask[c] = 1; return exposed(mask, nx, ny, nz, h, org); };
  const t0 = performance.now();
  let P = { nx, ny, nz, active, passive, fixedMask, force, vf: m.vf, rmin: m.rmin, maxIter: m.maxIter, am, solver: tc.solver };
  if (m.refine) { // start from the coarse design, keep the coarse volume as the cap, same filter radius in mm
    const par = S.parent, nFreeCells = S.free.reduce((a, v) => a + v, 0);
    let coarse = 0; for (let c = 0; c < par.cleared.length; c++) if (par.cleared[c] && par.free[c]) coarse++;
    const x0 = new Float64Array(N); for (let c = 0; c < N; c++) x0[c] = S.mat[c] ? 1 : 0.01;
    P = { ...P, vf: Math.min(1, (coarse * par.h ** 3) / (h ** 3 * nFreeCells)), rmin: m.rmin * par.h / h, x0, shrink: m.shrink };
  }
  const res = await optimize(P, async (s) => {
    const msg = { progress: true, cap: P.vf, it: s.it, maxIter: s.maxIter, c: s.c, c0: s.c0, vol: s.vol, change: s.change, cg: s.cg, elapsed: performance.now() - t0 };
    if (s.it % 2 === 1) msg.mesh = meshOf(s.rho);
    replyTo(m, msg, msg.mesh ? meshBufs(msg.mesh) : [], true);
    await new Promise((r) => setTimeout(r, 0)); // lets a Stop message arrive
  }, () => stopFlag);
  S.result = res.rho; S.active = active; S.cleared = null; S.smooth = null;
  if (m.refine) { // drop loose pieces and check the connection, as in the Clearance step
    const r = clearance(), par = S.parent;
    replyTo(m, { ok: true, it: res.it, c: res.c, c0: res.c0, vol: res.vol, stopped: res.stopped, converged: res.converged, elapsed: performance.now() - t0, mesh: r.mesh, stats: r.stats, h, hc: par.h, cap: P.vf, cRef: res.cRef, sag: sag(res.c) }, meshBufs(r.mesh));
    return;
  }
  const mesh = meshOf(res.rho);
  replyTo(m, { ok: true, it: res.it, c: res.c, c0: res.c0, vol: res.vol, stopped: res.stopped, converged: res.converged, elapsed: performance.now() - t0, mesh, sag: sag(res.c) }, meshBufs(mesh));
}

// Coarse material after the last Generate or Clearance (connect-surface cells included).
function coarseMask(S) { const mk = new Uint8Array(S.nx * S.ny * S.nz); for (let c = 0; c < mk.length; c++) if (S.active[c] && S.result[c] > 0.5) mk[c] = 1; return mk; }

// Refine: new grid at the display voxel size, only in a band around the coarse material, then a second optimization from the coarse design.
async function runRefine(m) {
  const base = state?.parent || state;
  if (!base?.result) throw new Error("Generate a design first.");
  if (!base.cleared) base.cleared = coarseMask(base);
  const r = compute({ ...base.input, h: m.h, budget: m.budget, maxCells: m.maxCells, restrict: { nx: base.nx, ny: base.ny, nz: base.nz, h: base.h, org: base.org, mask: base.cleared, bandMm: m.bandVoxels * base.h } });
  if (state.h > base.h * 0.99) { state = base; throw new Error(`The refined voxel (${r.stats.h.toFixed(2)} mm) cannot get finer than the analysis voxel (${base.h.toFixed(2)} mm). Raise the refine voxel budget or reduce the design space.`); }
  state.parent = base; state.input = base.input;
  replyTo(m, { refineInfo: true, stats: r.stats, hc: base.h }, [], true);
  const S = state;
  try { await runOptimize({ ...m, refine: true }); }
  catch (err) { state = base; throw err; } // a failed refine leaves the worker on the Draft, as the panel shows it
  if (m.level) levels[m.level] = S; // kept, so you can switch back to this level and smooth it
}

const need = () => { if (!state) throw new Error("Compute the design space first."); return state; };
const meshReply = (m, mesh, data = {}) => replyTo(m, { ok: true, mesh, ...data }, meshBufs(mesh));
const handlers = {
  bench: (m) => replyTo(m, { secPerElem: bench() }),
  async selftest(m) {
    try {
      replyTo(m, { results: selfTest([tc.cantileverRatio.min, tc.cantileverRatio.max]) }, [], true);
      const rf = tcRefine, pr = tc.printReady;
      replyTo(m, { results: [...amSelfTest(pr.smoothMaxPower, pr.smoothMinEps), ...await refineSelfTest(rf.stiffnessTolerance, rf.shrinkStep, rf.minVolumeFraction, tc.solver)] });
    } catch (err) { replyTo(m, { results: [{ ok: false, text: "Self-test crashed: " + err.message }] }); }
  },
  restore(m) { // switch to a finished level: the Draft (coarse result) or a kept refined level
    const base = state?.parent || state, target = m.draft ? base : levels[m.level];
    if (!target?.result) throw new Error(m.draft ? "There is no coarse result to go back to." : "This level is not kept any more. Refine it again.");
    state = target; state.smooth = null;
    if (!state.cleared) state.cleared = coarseMask(state);
    meshReply(m, exposed(state.cleared, state.nx, state.ny, state.nz, state.h, state.org));
  },
  refine: (m) => runRefine(m),
  optimize(m) {
    need(); if (state.parent) state = state.parent; // a refined grid is never optimized again
    levels = {}; // a new Draft: refined levels of the old one are gone
    return runOptimize(m);
  },
  smoothReset(m) { const S = need(); S.smooth = null; meshReply(m, exposed(S.cleared || coarseMask(S), S.nx, S.ny, S.nz, S.h, S.org), { reset: true, stats: {} }); },
  smooth(m) { need(); const r = smoothing(m.passes); meshReply(m, r.mesh, { stats: r.stats }); },
  smoothClear(m) { need(); const r = smoothClearance(); meshReply(m, r.mesh, { stats: r.stats }); },
  bridge(m) { const r = bridge(m, tc.bridge); meshReply(m, r.mesh, { stats: r.stats }); },
  clearPreview(m) { const S = need(); meshReply(m, exposed(clearZones().ring, S.nx, S.ny, S.nz, S.h, S.org)); },
  clear(m) { need(); const r = clearance(); meshReply(m, r.mesh, { stats: r.stats }); },
  domain(m) { const r = compute(m); replyTo(m, { ok: true, stats: r.stats, dom: r.dom, src: r.src, avoid: r.avoid }, meshBufs(r.dom, r.src, r.avoid)); },
};
const LONG = new Set(["selftest", "refine", "optimize"]); // these let other messages in while they run (to receive Stop)

onmessage = async (e) => {
  const m = e.data;
  if (m.type === "stop") { stopFlag = true; return; }
  const h = handlers[m.type]; if (!h) return;
  if (running) return replyTo(m, { ok: false, busy: true, error: "A design is running. Press Stop first." });
  const long = LONG.has(m.type);
  if (long) { running = true; stopFlag = false; }
  try { await h(m); } catch (err) { replyTo(m, { ok: false, error: err.message }); }
  finally { if (long) running = false; }
};
