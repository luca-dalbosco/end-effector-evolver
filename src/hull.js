// 3D convex hull of a point cloud (incremental: add points one by one, replace the faces they see). Units: mm.
// pts: flat list (3 numbers per point). Returns the face planes as a flat list [nx, ny, nz, d, ...]: a point p is inside when n·p ≤ d for every face.
export function convexHull(pts) {
  const seen = new Map(), P = [];
  for (let i = 0; i < pts.length; i += 3) { // drop duplicate points
    const key = `${Math.round(pts[i] * 1e4)},${Math.round(pts[i + 1] * 1e4)},${Math.round(pts[i + 2] * 1e4)}`;
    if (!seen.has(key)) { seen.set(key, 1); P.push([pts[i], pts[i + 1], pts[i + 2]]); }
  }
  const n = P.length; if (n < 4) throw new Error("Too few points to build the bridge.");
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = (a) => Math.hypot(a[0], a[1], a[2]);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  const eps = 1e-7 * Math.max(1, len(sub(hi, lo)));
  // starting tetrahedron: two far points, the point farthest from their line, the point farthest from their plane
  const far = (f) => { let b = -1, bv = -1; for (let i = 0; i < n; i++) { const v = f(P[i]); if (v > bv) { bv = v; b = i; } } return [b, bv]; };
  const [i0] = far((p) => -p[0]), [i1] = far((p) => len(sub(p, P[i0])));
  const d01 = sub(P[i1], P[i0]), [i2, e2] = far((p) => len(cross(d01, sub(p, P[i0]))) / len(d01));
  const n012 = cross(d01, sub(P[i2], P[i0])), [i3, e3] = far((p) => Math.abs(dot(n012, sub(p, P[i0]))) / len(n012));
  if (e2 < eps * 10 || e3 < eps * 10) throw new Error("The flange face and the picked faces lie in one plane. Move the tool away from the flange.");
  let faces = [];
  const add = (a, b, c) => { const nn = cross(sub(P[b], P[a]), sub(P[c], P[a])), l = len(nn) || 1, nv = [nn[0] / l, nn[1] / l, nn[2] / l]; faces.push({ v: [a, b, c], n: nv, d: dot(nv, P[a]) }); };
  const above = (f, p) => dot(f.n, p) - f.d;
  for (const [a, b, c, o] of [[i0, i1, i2, i3], [i0, i3, i1, i2], [i1, i3, i2, i0], [i0, i2, i3, i1]]) { add(a, b, c); if (above(faces.at(-1), P[o]) > 0) { faces.pop(); add(a, c, b); } }
  // far points first: they remove the most inner points early
  const cen = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2), order = [...Array(n).keys()].filter((i) => i !== i0 && i !== i1 && i !== i2 && i !== i3);
  order.sort((a, b) => len(sub(P[b], cen)) - len(sub(P[a], cen)));
  for (const i of order) {
    const p = P[i], vis = faces.filter((f) => above(f, p) > eps); if (!vis.length) continue;
    const edges = new Set(); for (const f of vis) for (let e = 0; e < 3; e++) edges.add(f.v[e] * n + f.v[(e + 1) % 3]);
    faces = faces.filter((f) => !vis.includes(f));
    for (const f of vis) for (let e = 0; e < 3; e++) { const a = f.v[e], b = f.v[(e + 1) % 3]; if (!edges.has(b * n + a)) add(a, b, i); } // horizon edge: its twin face stays
  }
  const out = new Float64Array(faces.length * 4);
  faces.forEach((f, k) => { out[4 * k] = f.n[0]; out[4 * k + 1] = f.n[1]; out[4 * k + 2] = f.n[2]; out[4 * k + 3] = f.d; });
  return out;
}
