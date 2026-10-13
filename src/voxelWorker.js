// Stage C worker (part 1): voxel grid, distance fields, design space preview, speed test.
// Pure JavaScript, no geometry kernel. Units: mm.

import { createFem, selfTest } from "./fem.js";
import { optimize } from "./optimizer.js";
import { voxelizeSolid, connected, solidCentroid, nodalLoads } from "./voxelize.js";
const BIG = 1e9;

// Speed test: seconds per element for one real solver matrix-vector product.
function bench() {
  const fem = createFem({ nx: 12, ny: 12, nz: 12 }), x = Float64Array.from({ length: fem.ndof }, (_, i) => Math.sin(i)), y = new Float64Array(fem.ndof);
  fem.setDensity(new Float64Array(fem.nel).fill(1));
  for (let r = 0; r < 20; r++) fem.matvec(x, y); // warm-up so the speed test is not pessimistic
  const t0 = performance.now();
  for (let r = 0; r < 20; r++) fem.matvec(x, y);
  return (performance.now() - t0) / 1000 / (20 * fem.nel);
}

// Points on triangles (flat list, 9 numbers per triangle), pushed slightly to the outside of the face.
// maxR: keep only points within this radius around the Z axis (null = keep all).
function samplePoints(tris, h, maxR) {
  const out = [], step = h * 0.5, push = h * 0.3;
  for (let q = 0; q < tris.length; q += 9) {
    const ax = tris[q], ay = tris[q + 1], az = tris[q + 2];
    const ux = tris[q + 3] - ax, uy = tris[q + 4] - ay, uz = tris[q + 5] - az;
    const wx = tris[q + 6] - ax, wy = tris[q + 7] - ay, wz = tris[q + 8] - az;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz); if (nl < 1e-12) continue;
    nx /= nl; ny /= nl; nz /= nl;
    const k = Math.max(1, Math.ceil(Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz)) / step));
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
      const s = i / k, t = j / k, x = ax + ux * s + wx * t, y = ay + uy * s + wy * t;
      if (maxR != null && Math.hypot(x, y) > maxR) continue;
      out.push(x + nx * push, y + ny * push, az + uz * s + wz * t + nz * push);
    }
  }
  return out;
}

// Exact squared distance to the nearest source cell (Felzenszwalb), in place, in voxel units.
function edt(f, nx, ny, nz) {
  const m = Math.max(nx, ny, nz), line = new Float64Array(m), out = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const dt = (n) => {
    let k = 0; v[0] = 0; z[0] = -1e30; z[1] = 1e30;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) { const p = v[k]; s = ((line[q] + q * q) - (line[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k]) k--; else break; }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; out[q] = (q - p) * (q - p) + line[p]; }
  };
  const pass = (n, stride, lines, offset) => {
    for (let l = 0; l < lines; l++) {
      const o = offset(l);
      for (let q = 0; q < n; q++) line[q] = f[o + q * stride];
      dt(n);
      for (let q = 0; q < n; q++) f[o + q * stride] = out[q];
    }
  };
  pass(nx, 1, ny * nz, (l) => l * nx);
  pass(ny, nx, nx * nz, (l) => (l % nx) + nx * ny * Math.floor(l / nx));
  pass(nz, nx * ny, nx * ny, (l) => l);
}

// Visible faces of a voxel set as a triangle mesh.
const D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const QUAD = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];
function exposed(mask, nx, ny, nz, h, org) {
  const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && mask[x + nx * (y + ny * z)] === 1;
  let q = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++)
    if (mask[x + nx * (y + ny * z)]) for (let d = 0; d < 6; d++) if (!at(x + D[d][0], y + D[d][1], z + D[d][2])) q++;
  const p = new Float32Array(q * 12), n = new Float32Array(q * 12), ix = new Uint32Array(q * 6);
  let qi = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!mask[x + nx * (y + ny * z)]) continue;
    for (let d = 0; d < 6; d++) {
      if (at(x + D[d][0], y + D[d][1], z + D[d][2])) continue;
      for (let c = 0; c < 4; c++) {
        const o = qi * 12 + c * 3, k = QUAD[d][c];
        p[o] = org[0] + (x + k[0]) * h; p[o + 1] = org[1] + (y + k[1]) * h; p[o + 2] = org[2] + (z + k[2]) * h;
        n[o] = D[d][0]; n[o + 1] = D[d][1]; n[o + 2] = D[d][2];
      }
      const b = qi * 4, i = qi * 6; ix[i] = b; ix[i + 1] = b + 1; ix[i + 2] = b + 2; ix[i + 3] = b; ix[i + 4] = b + 2; ix[i + 5] = b + 3;
      qi++;
    }
  }
  return { p, n, i: ix };
}

// Marks every cell a red item blocks. "solid": the whole object grown by mm. "face": the face pushed outward by mm along its normal.
function avoidMask(items, nx, ny, nz, org, h) {
  const N = nx * ny * nz, out = new Uint8Array(N), step = h * 0.5;
  const cell = (x, y, z) => {
    const i = Math.floor((x - org[0]) / h), j = Math.floor((y - org[1]) / h), k = Math.floor((z - org[2]) / h);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) out[i + nx * (j + ny * k)] = 1;
  };
  for (const it of items) {
    if (it.kind === "obj") {
      const m = voxelizeSolid(it.tris, nx, ny, nz, org, h);
      if (it.mm > 0) { // exact offset: distance from each cell centre to the nearest object cell centre (the half voxel makes it err on the safe side)
        const f = new Float32Array(N); for (let c = 0; c < N; c++) f[c] = m[c] ? 0 : BIG; edt(f, nx, ny, nz);
        const lim = (it.mm + 0.5 * h) / h; for (let c = 0; c < N; c++) if (Math.sqrt(f[c]) <= lim) out[c] = 1;
      } else for (let c = 0; c < N; c++) if (m[c]) out[c] = 1;
    } else {
      const t = it.tris;
      for (let q = 0; q < t.length; q += 9) {
        const ux = t[q + 3] - t[q], uy = t[q + 4] - t[q + 1], uz = t[q + 5] - t[q + 2], wx = t[q + 6] - t[q], wy = t[q + 7] - t[q + 1], wz = t[q + 8] - t[q + 2];
        let nxx = uy * wz - uz * wy, nyy = uz * wx - ux * wz, nzz = ux * wy - uy * wx;
        const nl = Math.hypot(nxx, nyy, nzz); if (nl < 1e-12) continue;
        nxx /= nl; nyy /= nl; nzz /= nl;
        const k = Math.max(1, Math.ceil(Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz)) / step)), ns = Math.max(1, Math.ceil(it.mm / step));
        for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
          const s = i / k, r = j / k, px = t[q] + ux * s + wx * r, py = t[q + 1] + uy * s + wy * r, pz = t[q + 2] + uz * s + wz * r;
          for (let n = 0; n <= ns; n++) { const d = (it.mm * n) / ns + h * 0.3; cell(px + nxx * d, py + nyy * d, pz + nzz * d); }
        }
      }
    }
  }
  return out;
}

// The tool start is never touched (plate cylinder), and nothing grows below it (Robot Avoidance cylinder).
function keepOutMask(k, nx, ny, nz, org, h) {
  const out = new Uint8Array(nx * ny * nz), r2 = k.R * k.R, rr2 = k.robotR * k.robotR;
  for (let z = 0; z < nz; z++) {
    const cz = org[2] + (z + 0.5) * h, lock = cz >= k.zMin && cz <= k.zTop, rob = cz < k.zMin; if (!lock && !rob) continue;
    const lim = lock ? r2 : rr2;
    for (let y = 0; y < ny; y++) { const cy = org[1] + (y + 0.5) * h; for (let x = 0; x < nx; x++) { const cx = org[0] + (x + 0.5) * h; if (cx * cx + cy * cy <= lim) out[x + nx * (y + ny * z)] = 1; } }
  }
  return out;
}

let state = null, running = false, stopFlag = false;
const GDIR = { "-X": [-1, 0, 0], "+X": [1, 0, 0], "-Y": [0, -1, 0], "+Y": [0, 1, 0], "-Z": [0, 0, -1], "+Z": [0, 0, 1] };

function compute(m) {
  let h = m.h;
  const A = samplePoints(m.startTris, h, m.R), B = samplePoints(m.endTris, h, null);
  if (!A.length) throw new Error("The tool start has no connect surface here. Try 'Entire top surface'.");
  if (!B.length) throw new Error("No tool end face selected.");
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], ca = [0, 0, 0], cb = [0, 0, 0];
  for (const [P, c] of [[A, ca], [B, cb]]) for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); c[a] += P[i + a] / (P.length / 3);
  }
  const Lest = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
  const side = 0.5 * Math.sqrt((1 + m.band) ** 2 - 1) * Lest;
  const cog = solidCentroid(m.endAll);
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
    if (best < 1) throw new Error("The tool start and the picked faces touch or overlap. Move the tool end away from the tool start.");
    const thr = best * (1 + m.band);
    const kS = voxelizeSolid(m.startAll, nx, ny, nz, org, h), kE = voxelizeSolid(m.endAll, nx, ny, nz, org, h);
    const free = new Uint8Array(N), vis = new Uint8Array(N), uni = new Uint8Array(N), lost = new Uint8Array(N), av = m.avoid?.length ? avoidMask(m.avoid, nx, ny, nz, org, h) : null, ko = m.keepOut ? keepOutMask(m.keepOut, nx, ny, nz, org, h) : null;
    let count = 0, nA = 0, nB = 0, nFree = 0, nAvoided = 0, avoidHitsSrc = false;
    for (let c = 0; c < N; c++) {
      if (srcA[c]) nA++; if (srcB[c]) nB++;
      if (srcA[c] || srcB[c]) { uni[c] = 1; vis[c] = 1; count++; if (av && av[c]) avoidHitsSrc = true; }
      else if (!kS[c] && !kE[c] && Math.sqrt(fA[c]) + Math.sqrt(fB[c]) <= thr) {
        if ((av && av[c]) || (ko && ko[c])) { lost[c] = 1; nAvoided++; continue; } // red: no voxel may grow here
        free[c] = 1; vis[c] = 1; count++; nFree++;
      }
    }
    if (!connected(vis, srcA, srcB, nx, ny, nz)) throw new Error("The tool start, the tool end or a red zone (including Robot Avoidance) blocks the way between the surfaces. Make the red zones smaller (for example a lower robot offset) or increase the design space size.");
    if (count > m.budget * 1.1 && !retried) { retried = true; h *= Math.cbrt(count / m.budget) * 1.02; continue; }
    state = { nx, ny, nz, h, org, srcA, srcB, free, cog };
    return {
      stats: { h, dim, count, nFree, L: best * h, nA, nB, nAvoided, avoidHitsSrc, overBudget: count > m.budget * 1.1 },
      dom: exposed(vis, nx, ny, nz, h, org), src: exposed(uni, nx, ny, nz, h, org), avoid: exposed(lost, nx, ny, nz, h, org),
    };
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
  const g = GDIR[m.gdir] || GDIR["-Y"], mag = m.mass * m.accel * 9.81;
  const F = [g[0] * mag + m.extra[0], g[1] * mag + m.extra[1], g[2] * mag + m.extra[2]];
  if (Math.hypot(...F) < 1e-9) throw new Error("The load is zero. Check payload mass and extra force.");
  const loads = nodalLoads(pos, F, S.cog);
  ids.forEach((n, q) => { for (let d = 0; d < 3; d++) force[3 * n + d] = loads[3 * q + d]; });

  const meshOf = (rho) => { const mask = new Uint8Array(N); for (let c = 0; c < N; c++) if (active[c] && rho[c] > 0.5) mask[c] = 1; return exposed(mask, nx, ny, nz, h, org); };
  const bufs = (mesh) => [mesh.p.buffer, mesh.n.buffer, mesh.i.buffer];
  const t0 = performance.now();
  const res = await optimize({ nx, ny, nz, active, passive, fixedMask, force, vf: m.vf, rmin: m.rmin, maxIter: m.maxIter }, async (s) => {
    const msg = { type: "progress", id: m.id, it: s.it, maxIter: s.maxIter, c: s.c, c0: s.c0, vol: s.vol, change: s.change, cg: s.cg, elapsed: performance.now() - t0 };
    if (s.it % 2 === 1) msg.mesh = meshOf(s.rho);
    postMessage(msg, msg.mesh ? bufs(msg.mesh) : []);
    await new Promise((r) => setTimeout(r, 0)); // lets a Stop message arrive
  }, () => stopFlag);
  S.result = res.rho;
  const mesh = meshOf(res.rho);
  postMessage({ type: "done", id: m.id, ok: true, it: res.it, c: res.c, c0: res.c0, vol: res.vol, stopped: res.stopped, converged: res.converged, elapsed: performance.now() - t0, mesh }, bufs(mesh));
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === "stop") { stopFlag = true; return; }
  if (running) { if (m.type === "domain") postMessage({ type: "domain", id: m.id, ok: false, error: "A design is running. Press Stop first." }); return; }
  if (m.type === "bench") return postMessage({ type: "bench", secPerElem: bench() });
  if (m.type === "selftest") return postMessage({ type: "selftest", results: selfTest() });
  if (m.type === "domain") {
    try {
      const r = compute(m);
      postMessage({ type: "domain", id: m.id, ok: true, stats: r.stats, dom: r.dom, src: r.src, avoid: r.avoid },
        [r.dom.p.buffer, r.dom.n.buffer, r.dom.i.buffer, r.src.p.buffer, r.src.n.buffer, r.src.i.buffer, r.avoid.p.buffer, r.avoid.n.buffer, r.avoid.i.buffer]);
    } catch (err) { postMessage({ type: "domain", id: m.id, ok: false, error: err.message }); }
  } else if (m.type === "optimize") {
    running = true; stopFlag = false;
    try { await runOptimize(m); } catch (err) { postMessage({ type: "done", id: m.id, ok: false, error: err.message }); }
    running = false;
  }
};