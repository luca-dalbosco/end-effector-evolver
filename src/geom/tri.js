// Triangle soups (flat lists, 9 numbers per triangle): sampling, exact distance. Pure functions, units: mm.

// Calls fn(x, y, z, nx, ny, nz) for points spread over triangle q (spacing ≤ step) with its unit normal. Skips flat triangles.
export function sampleTri(t, q, step, fn) {
  const ax = t[q], ay = t[q + 1], az = t[q + 2];
  const ux = t[q + 3] - ax, uy = t[q + 4] - ay, uz = t[q + 5] - az, wx = t[q + 6] - ax, wy = t[q + 7] - ay, wz = t[q + 8] - az;
  let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  const nl = Math.hypot(nx, ny, nz); if (nl < 1e-12) return;
  nx /= nl; ny /= nl; nz /= nl;
  const k = Math.max(1, Math.ceil(Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz)) / step));
  for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
    const s = i / k, r = j / k;
    fn(ax + ux * s + wx * r, ay + uy * s + wy * r, az + uz * s + wz * r, nx, ny, nz);
  }
}

// Points on triangles, pushed slightly to the outside of the face (flat list, 3 numbers per point).
// maxR: keep only points within this radius around the Z axis (null = keep all). push: how far out (mm).
export function samplePoints(tris, h, maxR, push = h * 0.3) {
  const out = [];
  for (let q = 0; q < tris.length; q += 9) sampleTri(tris, q, h * 0.5, (x, y, z, nx, ny, nz) => {
    if (maxR != null && Math.hypot(x, y) > maxR) return;
    out.push(x + nx * push, y + ny * push, z + nz * push);
  });
  return out;
}

// Squared distance from a point to triangle q. Closest point by the region of the triangle the point projects into.
export function triDist2(x, y, z, t, q) {
  const ax = t[q], ay = t[q + 1], az = t[q + 2], bx = t[q + 3] - ax, by = t[q + 4] - ay, bz = t[q + 5] - az, cx = t[q + 6] - ax, cy = t[q + 7] - ay, cz = t[q + 8] - az;
  const px = x - ax, py = y - ay, pz = z - az, d1 = bx * px + by * py + bz * pz, d2 = cx * px + cy * py + cz * pz;
  let u = 0, v = 0; // closest point = a + u·ab + v·ac
  if (d1 <= 0 && d2 <= 0) { /* corner a */ } else {
    const d3 = d1 - (bx * bx + by * by + bz * bz), d4 = d2 - (bx * cx + by * cy + bz * cz); // the same products seen from b
    const d5 = d1 - (bx * cx + by * cy + bz * cz), d6 = d2 - (cx * cx + cy * cy + cz * cz); // seen from c
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) u = 1;
    else if (d6 >= 0 && d5 <= d6) v = 1;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) u = d1 / (d1 - d3);
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) v = d2 / (d2 - d6);
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { v = (d4 - d3) / (d4 - d3 + (d5 - d6)); u = 1 - v; }
    else { const s = 1 / (va + vb + vc); u = vb * s; v = vc * s; }
  }
  const ex = px - bx * u - cx * v, ey = py - by * u - cy * v, ez = pz - bz * u - cz * v;
  return ex * ex + ey * ey + ez * ez;
}

// Exact distance (mm) from each cell centre to a triangle mesh, only within `band` mm of it (BIG elsewhere).
export function meshBand(tris, nx, ny, nz, org, h, band, BIG = 1e9) {
  const out = new Float32Array(nx * ny * nz).fill(BIG), b2 = band * band;
  const rng = (a, b, ax, n) => [Math.max(0, Math.floor((a - band - org[ax]) / h - 0.5)), Math.min(n - 1, Math.ceil((b + band - org[ax]) / h - 0.5))];
  for (let q = 0; q < tris.length; q += 9) {
    const [x0, x1] = rng(Math.min(tris[q], tris[q + 3], tris[q + 6]), Math.max(tris[q], tris[q + 3], tris[q + 6]), 0, nx);
    const [y0, y1] = rng(Math.min(tris[q + 1], tris[q + 4], tris[q + 7]), Math.max(tris[q + 1], tris[q + 4], tris[q + 7]), 1, ny);
    const [z0, z1] = rng(Math.min(tris[q + 2], tris[q + 5], tris[q + 8]), Math.max(tris[q + 2], tris[q + 5], tris[q + 8]), 2, nz);
    for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const d = triDist2(org[0] + (i + 0.5) * h, org[1] + (j + 0.5) * h, org[2] + (k + 0.5) * h, tris, q), c = i + nx * (j + ny * k);
      if (d < b2 && d < out[c]) out[c] = d;
    }
  }
  for (let c = 0; c < out.length; c++) if (out[c] < BIG) out[c] = Math.sqrt(out[c]);
  return out;
}
