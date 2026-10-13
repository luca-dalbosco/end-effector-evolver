// Stage C worker (part 1): voxel grid, distance fields, design space preview, speed test.
// Pure JavaScript, no geometry kernel. Units: mm.

import { createFem, selfTest } from "./fem.js";
import { optimize, refineSelfTest } from "./optimizer.js";
import tc from "../data/toolConnect.json";
const tcRefine = Object.fromEntries(Object.entries(tc.refine).map(([k, v]) => [k, v.default]));
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
  for (const b of k.bolts || []) { // Bolt Clearance: a cylinder above every screw head and the dowel hole
    for (let z = 0; z < nz; z++) {
      const cz = org[2] + (z + 0.5) * h; if (cz < b.z0 || cz > b.z1) continue;
      for (let y = 0; y < ny; y++) { const dy = org[1] + (y + 0.5) * h - b.y; for (let x = 0; x < nx; x++) { const dx = org[0] + (x + 0.5) * h - b.x; if (dx * dx + dy * dy <= b.r * b.r) out[x + nx * (y + ny * z)] = 1; } }
    }
  }
  return out;
}

// Clearance zones: every red item with its own gap (mm grow / mm out), plus the tool start, Robot Avoidance and Bolt Clearance.
// "ring" = the cells the gaps add around the items (the ghost shell).
function clearZones() {
  const S = state, { nx, ny, nz, h, org } = S, N = nx * ny * nz, blocked = new Uint8Array(N), ring = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (S.fixed[c]) blocked[c] = 1;
  for (const it of S.avoid) {
    const zone = avoidMask([it], nx, ny, nz, org, h), base = it.mm > 0 ? avoidMask([{ ...it, mm: 0 }], nx, ny, nz, org, h) : zone;
    for (let c = 0; c < N; c++) if (zone[c]) { blocked[c] = 1; if (!base[c]) ring[c] = 1; }
  }
  return { blocked, ring };
}

// Cells of mask (1/0) that touch a connect surface through face neighbours, and whether the tool end is among them.
function reach(mask, S) {
  const { nx, ny, nz } = S, N = nx * ny * nz, seen = new Uint8Array(N), queue = new Int32Array(N); let qh = 0, qt = 0, reachedB = false;
  for (let c = 0; c < N; c++) if (mask[c] && (S.srcA[c] || S.srcB[c])) { seen[c] = 1; queue[qt++] = c; }
  while (qh < qt) {
    const c = queue[qh++], x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    if (S.srcB[c]) reachedB = true;
    for (let d = 0; d < 6; d++) {
      const X = x + D[d][0], Y = y + D[d][1], Z = z + D[d][2]; if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const n = X + nx * (Y + ny * Z); if (!seen[n] && mask[n]) { seen[n] = 1; queue[qt++] = n; }
    }
  }
  return { seen, reachedB };
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
  const connectedAB = reachedB;
  S.cleared = mask; S.smooth = null;
  return { mesh: exposed(mask, nx, ny, nz, h, org), stats: { before, cut, islands, after: before - cut - islands, connected: connectedAB } };
}

// ---------- Smoothing ----------
// Smooth field: 0..1 per cell, 0.5 = the surface. Starts as the cleared voxels. Each pass blurs it, keeps the volume and pins the connect surfaces.
// clamp: cells outside the grid copy the edge cell (for distance fields); otherwise they count as empty.
function blur3(f, nx, ny, nz, clamp) {
  const t = new Float32Array(f.length), st = [1, nx, nx * ny], n = [nx, ny, nz];
  for (let a = 0; a < 3; a++) {
    const s = st[a], len = n[a];
    for (let c = 0; c < f.length; c++) {
      const q = Math.floor(c / s) % len, v = f[c];
      t[c] = 0.25 * (q > 0 ? f[c - s] : clamp ? v : 0) + 0.5 * v + 0.25 * (q < len - 1 ? f[c + s] : clamp ? v : 0);
    }
    f.set(t);
  }
}

// Shifts the field so that about `target` cells stay above 0.5 (blurring alone would shrink the part).
function holdVolume(f, target) {
  const B = 2048, hist = new Uint32Array(B + 1);
  for (let c = 0; c < f.length; c++) hist[Math.min(B, Math.max(0, Math.floor(f[c] * B)))]++;
  let cum = 0, b = B; for (; b > 0; b--) { cum += hist[b]; if (cum >= target) break; }
  const d = 0.5 - b / B + 0.5 / B;
  for (let c = 0; c < f.length; c++) f[c] = Math.min(1, Math.max(0, f[c] + d));
}

// Surface mesh of the 0.5 level (naive surface nets): one vertex per cell the surface crosses, one quad per crossed edge.
function surfaceNets(f, nx, ny, nz, h, org) {
  const iso = 0.5, mx = nx + 1, my = ny + 1, vid = new Int32Array(mx * my * (nz + 1)).fill(-1), v = new Float32Array(8);
  const val = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : f[x + nx * (y + ny * z)]);
  const EDGES = []; for (let a = 0; a < 8; a++) for (let k = 0; k < 3; k++) if (!(a & (1 << k))) EDGES.push([a, a | (1 << k)]);
  const pos = [], nor = [];
  for (let z = -1; z < nz; z++) for (let y = -1; y < ny; y++) for (let x = -1; x < nx; x++) {
    let mask = 0;
    for (let k = 0; k < 8; k++) { v[k] = val(x + (k & 1), y + ((k >> 1) & 1), z + (k >> 2)); if (v[k] > iso) mask |= 1 << k; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
      const t = (iso - v[a]) / (v[b] - v[a]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t; n++;
    }
    const gx = v[1] - v[0] + v[3] - v[2] + v[5] - v[4] + v[7] - v[6], gy = v[2] - v[0] + v[3] - v[1] + v[6] - v[4] + v[7] - v[5], gz = v[4] - v[0] + v[5] - v[1] + v[6] - v[2] + v[7] - v[3];
    const gl = Math.hypot(gx, gy, gz) || 1;
    vid[x + 1 + mx * (y + 1 + my * (z + 1))] = pos.length / 3;
    pos.push(org[0] + (x + 0.5 + sx / n) * h, org[1] + (y + 0.5 + sy / n) * h, org[2] + (z + 0.5 + sz / n) * h);
    nor.push(-gx / gl, -gy / gl, -gz / gl); // the field grows inward, so the outward normal is minus its gradient
  }
  const idx = [], q = [0, 0, 0];
  for (let z = -1; z < nz; z++) for (let y = -1; y < ny; y++) for (let x = -1; x < nx; x++) {
    const s0 = val(x, y, z) > iso;
    for (let a = 0; a < 3; a++) {
      if (s0 === (val(x + (a === 0), y + (a === 1), z + (a === 2)) > iso)) continue;
      const u = (a + 1) % 3, w = (a + 2) % 3;
      const at = (du, dw) => { q[0] = x; q[1] = y; q[2] = z; q[u] += du; q[w] += dw; return vid[q[0] + 1 + mx * (q[1] + 1 + my * (q[2] + 1))]; };
      const A = at(-1, -1), B = at(0, -1), C = at(0, 0), E = at(-1, 0);
      if (A < 0 || B < 0 || C < 0 || E < 0) continue;
      if (s0) idx.push(A, B, C, A, C, E); else idx.push(A, C, B, A, E, C);
    }
  }
  return { p: Float32Array.from(pos), n: Float32Array.from(nor), i: Uint32Array.from(idx) };
}

// Smooth field of the current result (made on the first use after a Generate, Clearance or Refine).
function smoothField(S) {
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
  const S = state, f = smoothField(S), { nx, ny, nz } = S, N = f.length, { blocked } = clearZones();
  const out = new Float32Array(N), inn = new Float32Array(N);
  for (let c = 0; c < N; c++) { out[c] = blocked[c] ? 0 : BIG; inn[c] = blocked[c] ? BIG : 0; }
  edt(out, nx, ny, nz); edt(inn, nx, ny, nz);
  const d = new Float32Array(N); // in voxels, positive outside the zones, zero on the zone surface
  for (let c = 0; c < N; c++) d[c] = blocked[c] ? -(Math.sqrt(inn[c]) - 0.5) : Math.sqrt(out[c]) - 0.5;
  blur3(d, nx, ny, nz, true); blur3(d, nx, ny, nz, true); // rounds the voxel steps of the zone surface
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

let state = null, running = false, stopFlag = false;
const GDIR = { "-X": [-1, 0, 0], "+X": [1, 0, 0], "-Y": [0, -1, 0], "+Y": [0, 1, 0], "-Z": [0, 0, -1], "+Z": [0, 0, 1] };

function compute(m) {
  let h = m.h;
  let A = samplePoints(m.startTris, h, m.R); const bo = m.keepOut?.bolts;
  if (bo) { const keep = []; for (let i = 0; i < A.length; i += 3) if (!bo.some((b) => A[i + 2] >= b.z0 - h && A[i + 2] <= b.z1 && Math.hypot(A[i] - b.x, A[i + 1] - b.y) <= b.r)) keep.push(A[i], A[i + 1], A[i + 2]); A = keep; }
  const B = samplePoints(m.endTris, h, null);
  if (!A.length) throw new Error("The tool start has no connect surface here. Try 'Entire top surface'.");
  if (!B.length) throw new Error("No tool end face selected.");
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
    if (best < 1) throw new Error("The tool start and the picked faces touch or overlap. Move the tool end away from the tool start.");
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
    if (!connected(vis, srcA, srcB, nx, ny, nz)) throw new Error("The tool start, the tool end or a red zone (including Robot Avoidance) blocks the way between the surfaces. Make the red zones smaller (for example a lower robot offset) or increase the design space size.");
    if (count > m.budget * 1.1 && !retried) { retried = true; h *= Math.cbrt(count / m.budget) * 1.02; continue; }
    const fixed = new Uint8Array(N); for (let c = 0; c < N; c++) if (kS[c] || (ko && ko[c])) fixed[c] = 1;
    state = { nx, ny, nz, h, org, srcA, srcB, free, cog, fixed, avoid: m.avoid || [], input: m, mat: rf ? rf.mat : null };
    const stats = { h, dim, count, nFree, L: best * h, nA, nB, nAvoided, avoidHitsSrc, overBudget: count > m.budget * 1.1 };
    if (rf) return { stats }; // refine: no preview meshes
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
  const g = GDIR[m.gdir] || GDIR["-Y"], mag = m.mass * m.accel * 9.81;
  const F = [g[0] * mag + m.extra[0], g[1] * mag + m.extra[1], g[2] * mag + m.extra[2]];
  if (Math.hypot(...F) < 1e-9) throw new Error("The load is zero. Check payload mass and extra force.");
  const loads = nodalLoads(pos, F, S.cog);
  ids.forEach((n, q) => { for (let d = 0; d < 3; d++) force[3 * n + d] = loads[3 * q + d]; });

  const meshOf = (rho) => { const mask = new Uint8Array(N); for (let c = 0; c < N; c++) if (active[c] && rho[c] > 0.5) mask[c] = 1; return exposed(mask, nx, ny, nz, h, org); };
  const bufs = (mesh) => [mesh.p.buffer, mesh.n.buffer, mesh.i.buffer];
  const t0 = performance.now();
  let P = { nx, ny, nz, active, passive, fixedMask, force, vf: m.vf, rmin: m.rmin, maxIter: m.maxIter };
  if (m.refine) { // start from the coarse design, keep the coarse volume as the cap, same filter radius in mm
    const par = S.parent, nFreeCells = S.free.reduce((a, v) => a + v, 0);
    let coarse = 0; for (let c = 0; c < par.cleared.length; c++) if (par.cleared[c] && par.free[c]) coarse++;
    const x0 = new Float64Array(N); for (let c = 0; c < N; c++) x0[c] = S.mat[c] ? 1 : 0.01;
    P = { ...P, vf: Math.min(1, (coarse * par.h ** 3) / (h ** 3 * nFreeCells)), rmin: m.rmin * par.h / h, x0, shrink: m.shrink };
  }
  const res = await optimize(P, async (s) => {
    const msg = { type: "progress", refine: !!m.refine, cap: P.vf, id: m.id, it: s.it, maxIter: s.maxIter, c: s.c, c0: s.c0, vol: s.vol, change: s.change, cg: s.cg, elapsed: performance.now() - t0 };
    if (s.it % 2 === 1) msg.mesh = meshOf(s.rho);
    postMessage(msg, msg.mesh ? bufs(msg.mesh) : []);
    await new Promise((r) => setTimeout(r, 0)); // lets a Stop message arrive
  }, () => stopFlag);
  S.result = res.rho; S.active = active; S.cleared = null; S.smooth = null;
  if (m.refine) { // drop loose pieces and check the connection, as in the Clearance step
    const r = clearance(), par = S.parent;
    postMessage({ type: "done", refine: true, id: m.id, ok: true, it: res.it, c: res.c, c0: res.c0, vol: res.vol, stopped: res.stopped, converged: res.converged, elapsed: performance.now() - t0, mesh: r.mesh, stats: r.stats, h, hc: par.h, cap: P.vf, cRef: res.cRef }, bufs(r.mesh));
    return;
  }
  const mesh = meshOf(res.rho);
  postMessage({ type: "done", id: m.id, ok: true, it: res.it, c: res.c, c0: res.c0, vol: res.vol, stopped: res.stopped, converged: res.converged, elapsed: performance.now() - t0, mesh }, bufs(mesh));
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
  postMessage({ type: "refineInfo", id: m.id, stats: r.stats, hc: base.h });
  await runOptimize({ ...m, refine: true });
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === "stop") { stopFlag = true; return; }
  if (running) { if (m.type === "domain") postMessage({ type: "domain", id: m.id, ok: false, error: "A design is running. Press Stop first." }); return; }
  if (m.type === "bench") return postMessage({ type: "bench", secPerElem: bench() });
  if (m.type === "selftest") {
    running = true;
    try {
      postMessage({ type: "selftest", results: selfTest() });
      const rf = tcRefine;
      postMessage({ type: "selftest", more: true, results: await refineSelfTest(rf.stiffnessTolerance, rf.shrinkStep, rf.minVolumeFraction) });
    } catch (err) { postMessage({ type: "selftest", more: true, results: [{ ok: false, text: "Self-test crashed: " + err.message }] }); }
    finally { running = false; }
    return;
  }
  if (m.type === "restore") { // back to the coarse result
    if (!state?.parent) return postMessage({ type: "restored", ok: false, error: "There is no coarse result to go back to." });
    state = state.parent; state.smooth = null;
    if (!state.cleared) state.cleared = coarseMask(state);
    const mesh = exposed(state.cleared, state.nx, state.ny, state.nz, state.h, state.org);
    return postMessage({ type: "restored", ok: true, mesh }, [mesh.p.buffer, mesh.n.buffer, mesh.i.buffer]);
  }
  if (m.type === "refine") {
    running = true; stopFlag = false;
    try { await runRefine(m); } catch (err) { postMessage({ type: "done", refine: true, id: m.id, ok: false, error: err.message }); }
    running = false;
    return;
  }
  if (m.type === "smooth" || m.type === "smoothClear" || m.type === "smoothReset") {
    if (!state) return;
    try {
      if (m.type === "smoothReset") { state.smooth = null; const mk = state.cleared || coarseMask(state), mesh = exposed(mk, state.nx, state.ny, state.nz, state.h, state.org); return postMessage({ type: "smoothed", id: m.id, ok: true, reset: true, mesh, stats: {} }, [mesh.p.buffer, mesh.n.buffer, mesh.i.buffer]); }
      const r = m.type === "smooth" ? smoothing(m.passes) : smoothClearance();
      postMessage({ type: "smoothed", id: m.id, ok: true, op: m.type, mesh: r.mesh, stats: r.stats }, [r.mesh.p.buffer, r.mesh.n.buffer, r.mesh.i.buffer]);
    } catch (err) { postMessage({ type: "smoothed", id: m.id, ok: false, error: err.message }); }
    return;
  }
  if (m.type === "clearPreview") {
    if (!state) return;
    try { const r = clearZones(), mesh = exposed(r.ring, state.nx, state.ny, state.nz, state.h, state.org); postMessage({ type: "clearPreview", id: m.id, mesh }, [mesh.p.buffer, mesh.n.buffer, mesh.i.buffer]); } catch (err) { /* preview only */ }
    return;
  }
  if (m.type === "clear") {
    try { const r = clearance(); postMessage({ type: "cleared", id: m.id, ok: true, stats: r.stats, mesh: r.mesh }, [r.mesh.p.buffer, r.mesh.n.buffer, r.mesh.i.buffer]); }
    catch (err) { postMessage({ type: "cleared", id: m.id, ok: false, error: err.message }); }
    return;
  }
  if (m.type === "domain") {
    try {
      const r = compute(m);
      postMessage({ type: "domain", id: m.id, ok: true, stats: r.stats, dom: r.dom, src: r.src, avoid: r.avoid },
        [r.dom.p.buffer, r.dom.n.buffer, r.dom.i.buffer, r.src.p.buffer, r.src.n.buffer, r.src.i.buffer, r.avoid.p.buffer, r.avoid.n.buffer, r.avoid.i.buffer]);
    } catch (err) { postMessage({ type: "domain", id: m.id, ok: false, error: err.message }); }
  } else if (m.type === "optimize") {
    running = true; stopFlag = false;
    if (state?.parent) state = state.parent; // a refined grid is never optimized again
    try { await runOptimize(m); } catch (err) { postMessage({ type: "done", id: m.id, ok: false, error: err.message }); }
    running = false;
  }
};