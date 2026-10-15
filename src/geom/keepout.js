// Zones where the connector may not grow: red items, the tool start, Flange Clearance, Bolt Clearance, the print bed.
// Pure functions on a voxel grid (nx, ny, nz cells of size h from corner org), units: mm.
import { distTo } from "./grid.js";
import { voxelizeSolid } from "./voxelize.js";
import { sampleTri } from "./tri.js";

// Marks every cell a red item blocks. "obj": the whole object grown by mm. "face": the face pushed outward by mm along its normal.
export function avoidMask(items, nx, ny, nz, org, h) {
  const N = nx * ny * nz, out = new Uint8Array(N), step = h * 0.5;
  const cell = (x, y, z) => {
    const i = Math.floor((x - org[0]) / h), j = Math.floor((y - org[1]) / h), k = Math.floor((z - org[2]) / h);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) out[i + nx * (j + ny * k)] = 1;
  };
  for (const it of items) {
    if (it.kind === "obj") {
      const m = voxelizeSolid(it.tris, nx, ny, nz, org, h);
      if (it.mm > 0) { // exact offset: distance from each cell centre to the nearest object cell centre (the half voxel makes it err on the safe side)
        const d = distTo(m, nx, ny, nz), lim = (it.mm + 0.5 * h) / h;
        for (let c = 0; c < N; c++) if (d[c] <= lim) out[c] = 1;
      } else for (let c = 0; c < N; c++) if (m[c]) out[c] = 1;
    } else {
      const ns = Math.max(1, Math.ceil(it.mm / step));
      for (let q = 0; q < it.tris.length; q += 9) sampleTri(it.tris, q, step, (px, py, pz, nxx, nyy, nzz) => {
        for (let n = 0; n <= ns; n++) { const d = (it.mm * n) / ns + h * 0.3; cell(px + nxx * d, py + nyy * d, pz + nzz * d); }
      });
    }
  }
  return out;
}

// Print-ready: the first layer whose cell centres are on or above the bed (the tool start top face). Everything below it is blocked.
export const bedLayer = (k, org, h) => Math.ceil((k.zTop - org[2]) / h - 0.5);

// Bolt Clearance is a slot: head diameter wide, from the bolt straight outward (away from the flange centre) for b.len mm (0 = cylinder).
// Distance in XY from a point to the slot centre line.
export function slotDist(b, x, y) {
  const l = Math.hypot(b.x, b.y), ux = l > 1e-9 ? b.x / l : 0, uy = l > 1e-9 ? b.y / l : 0;
  const t = Math.min(b.len, Math.max(0, (x - b.x) * ux + (y - b.y) * uy));
  return Math.hypot(x - b.x - ux * t, y - b.y - uy * t);
}

// The tool start is never touched (plate cylinder), and nothing grows below it (Flange Clearance cylinder).
// Print-ready (k.bed): nothing grows below the bed at all.
export function keepOutMask(k, nx, ny, nz, org, h) {
  const out = new Uint8Array(nx * ny * nz), r2 = k.R * k.R, rr2 = k.robotR * k.robotR, kb = k.bed ? bedLayer(k, org, h) : -1;
  for (let z = 0; z < nz; z++) {
    if (z < kb) { out.fill(1, nx * ny * z, nx * ny * (z + 1)); continue; }
    const cz = org[2] + (z + 0.5) * h, lock = cz >= k.zMin && cz <= k.zTop, rob = cz < k.zMin; if (!lock && !rob) continue;
    const lim = lock ? r2 : rr2;
    for (let y = 0; y < ny; y++) { const cy = org[1] + (y + 0.5) * h; for (let x = 0; x < nx; x++) { const cx = org[0] + (x + 0.5) * h; if (cx * cx + cy * cy <= lim) out[x + nx * (y + ny * z)] = 1; } }
  }
  for (const b of k.bolts || []) { // Bolt Clearance: a slot above every screw head and the dowel hole
    for (let z = 0; z < nz; z++) {
      const cz = org[2] + (z + 0.5) * h; if (cz < b.z0 || cz > b.z1) continue;
      for (let y = 0; y < ny; y++) { const cy = org[1] + (y + 0.5) * h; for (let x = 0; x < nx; x++) if (slotDist(b, org[0] + (x + 0.5) * h, cy) <= b.r) out[x + nx * (y + ny * z)] = 1; }
    }
  }
  return out;
}

// Signed distance (mm, negative inside) at a point to the analytic keep-outs: tool start plate, Flange Clearance, Bolt Clearance slots, bed.
export function keepOutDist(k, x, y, z) {
  const r = Math.hypot(x, y);
  let kk = Math.min(Math.max(r - k.R, z - k.zTop, k.zMin - z), Math.max(r - k.robotR, z - k.zMin));
  for (const b of k.bolts || []) kk = Math.min(kk, Math.max(slotDist(b, x, y) - b.r, b.z0 - z, z - b.z1));
  if (k.bed) kk = Math.min(kk, z - k.zTop);
  return kk;
}

// Print-ready only: voxels with nothing under them (none of the 5 cells below, 45° rule) that are not on the bed or a connect surface.
// g: { nx, ny, nz, org, h, srcA, srcB }, k: keep-out data. null when not print-ready.
export function overhangs(mask, g, k) {
  if (!k?.bed) return null;
  const { nx, ny, nz, srcA, srcB } = g, L = nx * ny, kb = bedLayer(k, g.org, g.h); let n = 0;
  for (let z = Math.max(1, kb + 1); z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = x + nx * (y + ny * z), d = c - L; if (!mask[c] || srcA[c] || srcB[c]) continue;
    if (!(mask[d] || (x > 0 && mask[d - 1]) || (x < nx - 1 && mask[d + 1]) || (y > 0 && mask[d - nx]) || (y < ny - 1 && mask[d + nx]))) n++;
  }
  return n;
}
