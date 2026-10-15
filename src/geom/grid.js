// Voxel grid helpers: distance fields, blur, flood fill. Pure functions (no DOM, no worker), units: voxels.
// Cell c = x + nx * (y + ny * z).
export const BIG = 1e9;
export const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Exact squared distance to the nearest source cell (Felzenszwalb), in place, in voxel units. f: 0 on sources, BIG elsewhere.
export function edt(f, nx, ny, nz) {
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

// Distance (voxels) from every cell centre to the nearest cell of mask (0 on mask cells).
export function distTo(mask, nx, ny, nz) {
  const f = new Float32Array(mask.length); for (let c = 0; c < f.length; c++) f[c] = mask[c] ? 0 : BIG;
  edt(f, nx, ny, nz); for (let c = 0; c < f.length; c++) f[c] = Math.sqrt(f[c]);
  return f;
}

// Signed distance (voxels) to the surface of a voxel mask: negative inside, zero on the surface (half a voxel from the
// cell centres), a little rounded by two blur passes so the voxel steps do not show.
export function signedDist(mask, nx, ny, nz) {
  const N = mask.length, out = new Float32Array(N), inn = new Float32Array(N);
  for (let c = 0; c < N; c++) { out[c] = mask[c] ? 0 : BIG; inn[c] = mask[c] ? BIG : 0; }
  edt(out, nx, ny, nz); edt(inn, nx, ny, nz);
  const d = new Float32Array(N);
  for (let c = 0; c < N; c++) d[c] = mask[c] ? -(Math.sqrt(inn[c]) - 0.5) : Math.sqrt(out[c]) - 0.5;
  blur3(d, nx, ny, nz, true); blur3(d, nx, ny, nz, true);
  return d;
}

// [1 2 1] / 4 blur along the 3 axes, in place.
// clamp: cells outside the grid copy the edge cell (for distance fields); otherwise they count as empty.
export function blur3(f, nx, ny, nz, clamp) {
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

// Shifts a 0..1 field so that about `target` cells stay above 0.5 (blurring alone would shrink the part).
export function holdVolume(f, target) {
  const B = 2048, hist = new Uint32Array(B + 1);
  for (let c = 0; c < f.length; c++) hist[Math.min(B, Math.max(0, Math.floor(f[c] * B)))]++;
  let cum = 0, b = B; for (; b > 0; b--) { cum += hist[b]; if (cum >= target) break; }
  const d = 0.5 - b / B + 0.5 / B;
  for (let c = 0; c < f.length; c++) f[c] = Math.min(1, Math.max(0, f[c] + d));
}

// Flood fill through face neighbours: the cells of open (1/0) reachable from the seed cells (seed[c] truthy and open[c]).
// stop(c) → true ends the fill early (returns { seen, stopped: true }).
export function flood(open, seed, nx, ny, nz, stop = null) {
  const N = nx * ny * nz, seen = new Uint8Array(N), queue = new Int32Array(N); let qh = 0, qt = 0;
  for (let c = 0; c < N; c++) if (open[c] && seed(c)) { seen[c] = 1; queue[qt++] = c; }
  while (qh < qt) {
    const c = queue[qh++]; if (stop && stop(c)) return { seen, stopped: true };
    const x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    for (let d = 0; d < 6; d++) {
      const X = x + D6[d][0], Y = y + D6[d][1], Z = z + D6[d][2]; if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const n = X + nx * (Y + ny * Z); if (!seen[n] && open[n]) { seen[n] = 1; queue[qt++] = n; }
    }
  }
  return { seen, stopped: false };
}
