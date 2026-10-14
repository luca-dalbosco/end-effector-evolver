// Bridge (Basic mode): solid wrap from the flange disc to the picked faces. Pure function, units: mm.
// Convex hull of the flange disc and the picked faces, narrowed in the middle (waist), minus the keep-outs.
// Everything is one signed distance (mm, negative inside), drawn with surface nets. No optimization, no FEM.
import { signedDist, flood } from "./grid.js";
import { surfaceNets } from "./mesh.js";
import { samplePoints, meshBand } from "./tri.js";
import { avoidMask, overhangs, keepOutDist } from "./keepout.js";
import { voxelizeSolid } from "./voxelize.js";
import { convexHull } from "./hull.js";

// m: { h, waist (%), maxCells, R (flange disc radius or null), endTris (picked faces), endAll (whole tool), avoid, keepOut }
// cfg: data/toolConnect.json "bridge" block (circleSegments, printCheckCells, printWaistSteps)
export function bridge(m, cfg) {
  const t0 = performance.now(), k = m.keepOut, zTop = k.zTop, RA = m.R ?? k.R, E = m.endTris, pts = [];
  for (let i = 0; i < cfg.circleSegments; i++) { const a = (2 * Math.PI * i) / cfg.circleSegments; pts.push(RA * Math.cos(a), RA * Math.sin(a), zTop); }
  const cB = [0, 0, 0], nS = [0, 0, 0]; let area = 0;
  for (let q = 0; q < E.length; q += 9) { // area-weighted centre and normal of the picked faces
    const ux = E[q + 3] - E[q], uy = E[q + 4] - E[q + 1], uz = E[q + 5] - E[q + 2], wx = E[q + 6] - E[q], wy = E[q + 7] - E[q + 1], wz = E[q + 8] - E[q + 2];
    const cr = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx], A = Math.hypot(...cr);
    area += A; for (let a = 0; a < 3; a++) { cB[a] += (A * (E[q + a] + E[q + 3 + a] + E[q + 6 + a])) / 3; nS[a] += cr[a]; }
    for (let i = 0; i < 9; i++) pts.push(E[q + i]);
  }
  if (!(area > 0)) throw new Error("No tool face selected.");
  for (let a = 0; a < 3; a++) cB[a] /= area;
  const cA = [0, 0, zTop], ax = [cB[0], cB[1], cB[2] - zTop], L = Math.hypot(...ax);
  if (L < 1e-3) throw new Error("The picked faces sit on the flange centre. Move the tool away from the robot side.");
  const u = ax.map((v) => v / L), nl = Math.hypot(...nS);
  const pn = nl > 0.3 * area ? nS.map((v) => v / nl) : u.map((v) => -v); // plane of the picked faces (or across the axis if they face many ways)
  const sg = pn[0] * (cA[0] - cB[0]) + pn[1] * (cA[1] - cB[1]) + pn[2] * (cA[2] - cB[2]) >= 0 ? 1 : -1;
  const planes = convexHull(pts), np = planes.length;
  const hullSd = (x, y, z, cut) => { let s = -Infinity; for (let i = 0; i < np; i += 4) { const v = planes[i] * x + planes[i + 1] * y + planes[i + 2] * z - planes[i + 3]; if (v > s) { s = v; if (s > cut) return s; } } return s; };
  // waist: s = 0 on the flange face, 1 on the picked faces' plane; the cross-section across the axis is scaled by w(s) = 1 − W·4s(1−s)
  const shape = (x, y, z, W, cut) => {
    if (W <= 0) return hullSd(x, y, z, cut);
    const dA = Math.max(0, z - zTop), dB = Math.max(0, sg * (pn[0] * (x - cB[0]) + pn[1] * (y - cB[1]) + pn[2] * (z - cB[2]))), s = dA + dB > 1e-9 ? dA / (dA + dB) : 0;
    const w = 1 - W * 4 * s * (1 - s), rx = x - ax[0] * s, ry = y - ax[1] * s, rz = z - zTop - ax[2] * s, ru = rx * u[0] + ry * u[1] + rz * u[2], f = 1 / w - 1;
    return hullSd(x + (rx - ru * u[0]) * f, y + (ry - ru * u[1]) * f, z + (rz - ru * u[2]) * f, cut / w) * w;
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pts[i + a]); hi[a] = Math.max(hi[a], pts[i + a]); }
  const grid = (h, maxCells) => {
    h = Math.max(h, Math.cbrt(hi.reduce((p, v, a) => p * (v - lo[a] + 6 * h), 1) / maxCells));
    const org = lo.map((v) => v - 3 * h), dim = hi.map((v, a) => Math.ceil((v + 3 * h - org[a]) / h) + 1);
    return { h, org, nx: dim[0], ny: dim[1], nz: dim[2], N: dim[0] * dim[1] * dim[2] };
  };
  // The shape in every cell: exact where |sd| ≤ cut, above cut where it is larger (outside), always with the right sign.
  // Coarse first: samples every BLOCK cells. A block whose 8 samples are all far from the surface (same sign, |sd| > T) is
  // interpolated; the shape changes by at most LIP mm per mm, so no cell inside it can reach the surface band. Other blocks are exact.
  const BLOCK = 2, LIP = 2; // BLOCK 2 was the fastest on test parts (curved face 7.0 → 3.4 s, same result to the byte)
  const fill = (g, W, cut) => {
    const { nx, ny, nz, h, org } = g, sd = new Float32Array(g.N), at = (x, y, z, c) => shape(org[0] + (x + 0.5) * h, org[1] + (y + 0.5) * h, org[2] + (z + 0.5) * h, W, c);
    const nodes = (n) => { const a = []; for (let i = 0; i < n - 1; i += BLOCK) a.push(i); a.push(n - 1); return a; }, X = nodes(nx), Y = nodes(ny), Z = nodes(nz);
    const T = LIP * h * BLOCK * Math.sqrt(3) / 2 + Math.max(0, cut) + h, cx = X.length, cy = Y.length, cs = new Float32Array(cx * cy * Z.length);
    for (let k = 0; k < Z.length; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) cs[i + cx * (j + cy * k)] = at(X[i], Y[j], Z[k], T);
    const v = new Float32Array(8), last = (A, i) => (i + 2 === A.length ? A[i + 1] : A[i + 1] - 1); // each cell once: a block ends one cell before the next block
    for (let k = 0; k + 1 < Z.length; k++) for (let j = 0; j + 1 < cy; j++) for (let i = 0; i + 1 < cx; i++) {
      let pos = 0, neg = 0;
      for (let q = 0; q < 8; q++) { const a = (v[q] = cs[i + (q & 1) + cx * (j + ((q >> 1) & 1) + cy * (k + (q >> 2)))]); if (a > T) pos++; else if (a < -T) neg++; }
      const far = pos === 8 || neg === 8;
      const x0 = X[i], x1 = X[i + 1], y0 = Y[j], y1 = Y[j + 1], z0 = Z[k], z1 = Z[k + 1];
      for (let z = z0, ze = last(Z, k); z <= ze; z++) for (let y = y0, ye = last(Y, j); y <= ye; y++) for (let x = x0, xe = last(X, i); x <= xe; x++) {
        const c = x + nx * (y + ny * z);
        if (!far) { sd[c] = at(x, y, z, cut); continue; }
        const u = (x - x0) / (x1 - x0 || 1), w = (y - y0) / (y1 - y0 || 1), s = (z - z0) / (z1 - z0 || 1);
        const a = v[0] + (v[1] - v[0]) * u, b = v[2] + (v[3] - v[2]) * u, d = v[4] + (v[5] - v[4]) * u, e = v[6] + (v[7] - v[6]) * u;
        sd[c] = (a + (b - a) * w) * (1 - s) + (d + (e - d) * w) * s;
      }
    }
    return sd;
  };
  // print-ready: lower the waist until the wrap overhangs no more than the straight wrap (45° rule, on a coarse grid)
  let W = Math.max(0, m.waist) / 100;
  if (k.bed && W > 0) {
    const g = grid(2 * m.h, cfg.printCheckCells), zero = new Uint8Array(g.N), G = { ...g, srcA: zero, srcB: zero };
    const over = (w) => { const sd = fill(g, w, 0), mk = new Uint8Array(g.N); for (let c = 0; c < g.N; c++) if (sd[c] < 0) mk[c] = 1; return overhangs(mk, G, k); };
    const base = over(0);
    if (over(W) > base) { let a = 0, b = W; for (let i = 0; i < cfg.printWaistSteps; i++) { const mid = (a + b) / 2; if (over(mid) > base) b = mid; else a = mid; } W = a; }
  }
  const g = grid(m.h, m.maxCells), { h, org, nx, ny, nz, N } = g, sd = fill(g, W, 2 * h);
  // keep-outs, all analytic: tool start plate, Flange Clearance, Bolt Clearance slots, bed
  for (let z = 0, c = 0; z < nz; z++) { const cz = org[2] + (z + 0.5) * h;
    for (let y = 0; y < ny; y++) { const cy = org[1] + (y + 0.5) * h;
      for (let x = 0; x < nx; x++, c++) {
        if (sd[c] > 2 * h) continue;
        const kk = keepOutDist(k, org[0] + (x + 0.5) * h, cy, cz);
        if (-kk > sd[c]) sd[c] = -kk;
      } } }
  // the tool end: exact distance near its surface, sign from the voxelized solid
  const inE = voxelizeSolid(m.endAll, nx, ny, nz, org, h), dE = meshBand(m.endAll, nx, ny, nz, org, h, 2 * h);
  for (let c = 0; c < N; c++) { const e = inE[c] ? dE[c] : -dE[c]; if (e > sd[c]) sd[c] = e; }
  if (m.avoid?.length) { // red items: signed distance to their zones (voxel accurate, a little rounded, as in Re-cut clearances)
    const d = signedDist(avoidMask(m.avoid, nx, ny, nz, org, h), nx, ny, nz);
    for (let c = 0; c < N; c++) if (-d[c] * h > sd[c]) sd[c] = -d[c] * h;
  }
  // connection check: the first layer on the flange face (A) and the cells on the picked faces (B)
  const mask = new Uint8Array(N), srcA = new Uint8Array(N), srcB = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (sd[c] < 0) mask[c] = 1;
  const kA = Math.floor((zTop - org[2]) / h + 0.5); // first layer with its centre above the flange face
  if (kA >= 0 && kA < nz) for (let c = nx * ny * kA; c < nx * ny * (kA + 1); c++) if (mask[c]) srcA[c] = 1;
  const B = samplePoints(E, h, null, h); // one voxel out: the cell holding the point is then always outside the tool
  for (let i = 0; i < B.length; i += 3) {
    const x = Math.floor((B[i] - org[0]) / h), y = Math.floor((B[i + 1] - org[1]) / h), z = Math.floor((B[i + 2] - org[2]) / h);
    if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && mask[x + nx * (y + ny * z)]) srcB[x + nx * (y + ny * z)] = 1;
  }
  const connected = flood(mask, (c) => srcA[c], nx, ny, nz, (c) => srcB[c]).stopped;
  const all = flood(mask, (c) => srcA[c] || srcB[c], nx, ny, nz).seen;
  const f = new Float32Array(N); let islands = 0, vol = 0;
  for (let c = 0; c < N; c++) {
    if (mask[c] && !all[c]) { mask[c] = 0; islands++; continue; } // loose piece: dropped
    f[c] = Math.min(1, Math.max(0, 0.5 - sd[c] / (2 * h)));
    if (mask[c]) vol++;
  }
  const mesh = surfaceNets(f, nx, ny, nz, h, org);
  return { mesh, stats: { h, waist: W * 100, waistCut: W < Math.max(0, m.waist) / 100 - 1e-9, volCm3: (vol * h ** 3) / 1000, overhang: overhangs(mask, { nx, ny, nz, org, h, srcA, srcB }, k), connected, islands, tris: mesh.i.length / 3, ms: performance.now() - t0 } };
}
