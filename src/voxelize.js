// Helpers for stage C: voxelize a solid, check the way is open, spread a load over a rigid face. Units: mm.
const EX = 1.234e-6, EY = 0.567e-6; // tiny shift so rays never hit a triangle edge exactly
const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Marks the cells whose centre is inside a closed triangle mesh (tris: 9 numbers per triangle).
export function voxelizeSolid(tris, nx, ny, nz, org, h) {
  const cols = new Array(nx * ny).fill(null), out = new Uint8Array(nx * ny * nz);
  for (let q = 0; q < tris.length; q += 9) {
    const x0 = tris[q], y0 = tris[q + 1], z0 = tris[q + 2], x1 = tris[q + 3], y1 = tris[q + 4], z1 = tris[q + 5], x2 = tris[q + 6], y2 = tris[q + 7], z2 = tris[q + 8];
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2); if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1, x2) - org[0]) / h - 0.5)), i1 = Math.min(nx - 1, Math.ceil((Math.max(x0, x1, x2) - org[0]) / h - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(y0, y1, y2) - org[1]) / h - 0.5)), j1 = Math.min(ny - 1, Math.ceil((Math.max(y0, y1, y2) - org[1]) / h - 0.5));
    for (let j = j0; j <= j1; j++) {
      const cy = org[1] + (j + 0.5) * h + EY;
      for (let i = i0; i <= i1; i++) {
        const cx = org[0] + (i + 0.5) * h + EX;
        const a = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / det, b = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / det, c = 1 - a - b;
        if (a < 0 || b < 0 || c < 0) continue;
        (cols[i + nx * j] ||= []).push(a * z0 + b * z1 + c * z2);
      }
    }
  }
  for (let col = 0; col < cols.length; col++) {
    const z = cols[col]; if (!z || z.length < 2) continue;
    z.sort((p, q) => p - q);
    for (let s = 0; s + 1 < z.length; s += 2) {
      const k0 = Math.max(0, Math.ceil((z[s] - org[2]) / h - 0.5)), k1 = Math.min(nz - 1, Math.floor((z[s + 1] - org[2]) / h - 0.5));
      for (let k = k0; k <= k1; k++) out[col + nx * ny * k] = 1;
    }
  }
  return out;
}

// True if the open cells connect some A cell to some B cell.
export function connected(open, srcA, srcB, nx, ny, nz) {
  const N = nx * ny * nz, seen = new Uint8Array(N), queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let c = 0; c < N; c++) if (srcA[c]) { seen[c] = 1; queue[qt++] = c; }
  while (qh < qt) {
    const c = queue[qh++]; if (srcB[c]) return true;
    const x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    for (const [dx, dy, dz] of D6) {
      const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const n = X + nx * (Y + ny * Z); if (!seen[n] && open[n]) { seen[n] = 1; queue[qt++] = n; }
    }
  }
  return false;
}

// Volume centre of a closed triangle mesh (falls back to the bounding box centre).
export function solidCentroid(tris) {
  let V = 0, sx = 0, sy = 0, sz = 0; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let q = 0; q < tris.length; q += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [tris[q], tris[q + 1], tris[q + 2], tris[q + 3], tris[q + 4], tris[q + 5], tris[q + 6], tris[q + 7], tris[q + 8]];
    const v = (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    V += v; sx += (v * (ax + bx + cx)) / 4; sy += (v * (ay + by + cy)) / 4; sz += (v * (az + bz + cz)) / 4;
    for (let a = 0; a < 3; a++) for (let p = 0; p < 3; p++) { lo[a] = Math.min(lo[a], tris[q + 3 * p + a]); hi[a] = Math.max(hi[a], tris[q + 3 * p + a]); }
  }
  return Math.abs(V) > 1e-6 ? [sx / V, sy / V, sz / V] : lo.map((l, a) => (l + hi[a]) / 2);
}

// A rigid tool end carries force F (N) acting at point P. Returns a force for each node (pos = xyz in mm) so that the
// total force and the moment about the nodes' centre are right. Scaled so |F| = 1.
export function nodalLoads(pos, F, P) {
  const n = pos.length / 3, c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) c[a] += pos[3 * i + a] / n;
  const d = [P[0] - c[0], P[1] - c[1], P[2] - c[2]];
  const M = [d[1] * F[2] - d[2] * F[1], d[2] * F[0] - d[0] * F[2], d[0] * F[1] - d[1] * F[0]];
  const J = new Array(9).fill(0);
  for (let i = 0; i < n; i++) {
    const r = [pos[3 * i] - c[0], pos[3 * i + 1] - c[1], pos[3 * i + 2] - c[2]], r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) J[3 * a + b] += (a === b ? r2 : 0) - r[a] * r[b];
  }
  const reg = 1e-9 * (J[0] + J[4] + J[8]) + 1e-12; J[0] += reg; J[4] += reg; J[8] += reg;
  const [a, b, cc, dd, e, f, g, hh, k] = J, det = a * (e * k - f * hh) - b * (dd * k - f * g) + cc * (dd * hh - e * g);
  const w = Math.abs(det) < 1e-30 || !isFinite(det) ? [0, 0, 0] : [
    (M[0] * (e * k - f * hh) - b * (M[1] * k - f * M[2]) + cc * (M[1] * hh - e * M[2])) / det,
    (a * (M[1] * k - f * M[2]) - M[0] * (dd * k - f * g) + cc * (dd * M[2] - M[1] * g)) / det,
    (a * (e * M[2] - M[1] * hh) - b * (dd * M[2] - M[1] * g) + M[0] * (dd * hh - e * g)) / det,
  ];
  const fm = Math.hypot(F[0], F[1], F[2]), out = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const r = [pos[3 * i] - c[0], pos[3 * i + 1] - c[1], pos[3 * i + 2] - c[2]];
    out[3 * i] = (F[0] / n + w[1] * r[2] - w[2] * r[1]) / fm;
    out[3 * i + 1] = (F[1] / n + w[2] * r[0] - w[0] * r[2]) / fm;
    out[3 * i + 2] = (F[2] / n + w[0] * r[1] - w[1] * r[0]) / fm;
  }
  return out;
}