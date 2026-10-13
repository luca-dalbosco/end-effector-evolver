// Stage C worker (part 1): voxel grid, distance fields, design space preview, speed test.
// Pure JavaScript, no geometry kernel. Units: mm.

import { createFem, selfTest } from "./fem.js";
const BIG = 1e9;

// Speed test: seconds per element for one real solver matrix-vector product.
function bench() {
  const fem = createFem({ nx: 12, ny: 12, nz: 12 }), x = Float64Array.from({ length: fem.ndof }, (_, i) => Math.sin(i)), y = new Float64Array(fem.ndof);
  fem.setDensity(new Float64Array(fem.nel).fill(1));
  fem.matvec(x, y);
  const t0 = performance.now();
  for (let r = 0; r < 10; r++) fem.matvec(x, y);
  return (performance.now() - t0) / 1000 / (10 * fem.nel);
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
    const thr = best * (1 + m.band), dom = new Uint8Array(N), uni = new Uint8Array(N);
    let count = 0, nA = 0, nB = 0;
    const layer = nx * ny;
    for (let c = 0; c < N; c++) {
      if (srcA[c]) nA++; if (srcB[c]) nB++;
      uni[c] = srcA[c] | srcB[c];
      const above = org[2] + (Math.floor(c / layer) + 1) * h > m.zClip; // nothing below the tool start top plane
      if (uni[c] || (above && Math.sqrt(fA[c]) + Math.sqrt(fB[c]) <= thr)) { dom[c] = 1; count++; }
    }
    if (count > m.budget * 1.1 && !retried) { retried = true; h *= Math.cbrt(count / m.budget) * 1.02; continue; }
    return {
      stats: { h, dim, count, L: best * h, nA, nB, overBudget: count > m.budget * 1.1 },
      dom: exposed(dom, nx, ny, nz, h, org), src: exposed(uni, nx, ny, nz, h, org),
    };
  }
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === "bench") return postMessage({ type: "bench", secPerElem: bench() });
  if (m.type === "selftest") return postMessage({ type: "selftest", results: selfTest() });
  if (m.type !== "domain") return;
  try {
    const r = compute(m);
    postMessage({ type: "domain", id: m.id, ok: true, stats: r.stats, dom: r.dom, src: r.src },
      [r.dom.p.buffer, r.dom.n.buffer, r.dom.i.buffer, r.src.p.buffer, r.src.n.buffer, r.src.i.buffer]);
  } catch (err) { postMessage({ type: "domain", id: m.id, ok: false, error: err.message }); }
};