// Voxel grids to triangle meshes ({ p: positions, n: normals, i: indices }). Pure functions, units: mm.
import { D6 } from "./grid.js";

// Visible faces of a voxel set (1/0 per cell) as a triangle mesh.
const QUAD = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];
// Two solid cells that touch only along an edge (the other two cells around that edge empty) make an edge shared by four faces,
// which slicers read as non-manifold. One of the two empty cells is filled (the one with the higher score) so the edge becomes a normal bend.
// sol: 1 = solid, changed in place. Repeats until no such edge is left (a fill can create a new one). Returns the number of cells added.
function fillPinches(sol, nx, ny, nz, score) {
  const str = [1, nx, nx * ny], dim = [nx, ny, nz];
  let added = 0;
  for (let pass = 0; pass < 32; pass++) {
    let changed = false;
    for (let ax = 0; ax < 3; ax++) {
      const u = (ax + 1) % 3, w = (ax + 2) % 3, su = str[u], sw = str[w];
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const c = [x, y, z]; if (c[u] + 1 >= dim[u] || c[w] + 1 >= dim[w]) continue;
        const i = x + nx * (y + ny * z), a = sol[i], b = sol[i + su], d = sol[i + sw], e = sol[i + su + sw];
        let p, q;
        if (a && e && !b && !d) { p = i + su; q = i + sw; } else if (b && d && !a && !e) { p = i; q = i + su + sw; } else continue;
        const k = score && score[q] > score[p] ? q : p;
        sol[k] = 1; added++; changed = true;
      }
    }
    if (!changed) break;
  }
  return added;
}

export function exposed(src, nx, ny, nz, h, org) {
  const mask = Uint8Array.from(src, (v) => (v ? 1 : 0)); fillPinches(mask, nx, ny, nz);
  const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && mask[x + nx * (y + ny * z)] === 1;
  let q = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++)
    if (mask[x + nx * (y + ny * z)]) for (let d = 0; d < 6; d++) if (!at(x + D6[d][0], y + D6[d][1], z + D6[d][2])) q++;
  const p = new Float32Array(q * 12), n = new Float32Array(q * 12), ix = new Uint32Array(q * 6);
  let qi = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!mask[x + nx * (y + ny * z)]) continue;
    for (let d = 0; d < 6; d++) {
      if (at(x + D6[d][0], y + D6[d][1], z + D6[d][2])) continue;
      for (let c = 0; c < 4; c++) {
        const o = qi * 12 + c * 3, k = QUAD[d][c];
        p[o] = org[0] + (x + k[0]) * h; p[o + 1] = org[1] + (y + k[1]) * h; p[o + 2] = org[2] + (z + k[2]) * h;
        n[o] = D6[d][0]; n[o + 1] = D6[d][1]; n[o + 2] = D6[d][2];
      }
      const b = qi * 4, i = qi * 6; ix[i] = b; ix[i + 1] = b + 1; ix[i + 2] = b + 2; ix[i + 3] = b; ix[i + 4] = b + 2; ix[i + 5] = b + 3;
      qi++;
    }
  }
  return { p, n, i: ix };
}

// Surface mesh of the 0.5 level of a 0..1 field (naive surface nets): one vertex per cell the surface crosses, one quad per crossed edge.
export function surfaceNets(f0, nx, ny, nz, h, org) {
  const iso = 0.5, f = Float32Array.from(f0), sol = new Uint8Array(f.length); // f: private copy, pinched edges are closed in it
  for (let c = 0; c < f.length; c++) if (f[c] > iso) sol[c] = 1;
  fillPinches(sol, nx, ny, nz, f);
  for (let c = 0; c < f.length; c++) if (sol[c] && !(f[c] > iso)) f[c] = iso + 1e-3;
  const mx = nx + 1, my = ny + 1, vid = new Int32Array(mx * my * (nz + 1)).fill(-1), v = new Float32Array(8);
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
