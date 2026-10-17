// Face snapping (stage B): find the flat face under a click, and move one part so that its face lies flat against another face.
import * as THREE from "three";

const EPS = 1e-4;
const pt = (P, v) => new THREE.Vector3(P[3 * v], P[3 * v + 1], P[3 * v + 2]);
const key = (P, v) => `${P[3 * v].toFixed(3)},${P[3 * v + 1].toFixed(3)},${P[3 * v + 2].toFixed(3)}`;

// Flat face around triangle number `tri` of `mesh`. `group` holds the B-rep face ranges (userData.fg) when the part has them;
// without them (the robot side) the face is every connected triangle lying in the same plane.
// Returns { ok, n, c } (outward normal and area-centre, in the mesh's own space) or { ok: false } for a curved face.
const cache = new WeakMap(); // mesh → (triangle → its face): a mesh never changes, and the hover asks again on every mouse move
export function faceAt(mesh, group, tri) {
  const c = cache.get(mesh)?.get(tri); if (c) return c;
  const f = findFace(mesh, group, tri); if (!cache.has(mesh)) cache.set(mesh, new Map());
  for (const t of f.tris ?? [tri]) cache.get(mesh).set(t, f);
  return f;
}

// Triangle numbers of the B-rep face (userData.fg range) that triangle `tri` belongs to, flat or curved; null if the part has no face data.
export function faceTris(mesh, group, tri) {
  const nTri = mesh.geometry.index.count / 3, fg = group.userData.fg || [], k = fg.reduce((m, g) => Math.max(m, g.start + g.count), 0) > nTri ? 3 : 1; // ranges may be in index or triangle units
  const g = fg.find((x) => tri * 3 >= (x.start / k) * 3 && tri * 3 < ((x.start + x.count) / k) * 3); if (!g) return null;
  return Array.from({ length: g.count / k }, (_, i) => g.start / k + i);
}

function findFace(mesh, group, tri) {
  const P = mesh.geometry.getAttribute("position").array, I = mesh.geometry.index.array, nTri = I.length / 3;
  const info = (t) => { const a = pt(P, I[3 * t]), b = pt(P, I[3 * t + 1]), c = pt(P, I[3 * t + 2]), cr = b.clone().sub(a).cross(c.clone().sub(a)); return { n: cr.clone().normalize(), area: cr.length() / 2, mid: a.add(b).add(c).divideScalar(3) }; };
  const T = new Array(nTri), get = (t) => (T[t] ??= info(t));
  const n0 = get(tri).n, d0 = n0.dot(get(tri).mid), flat = (t) => get(t).n.dot(n0) > 1 - EPS && Math.abs(n0.dot(get(t).mid) - d0) < 1e-2;
  let tris = faceTris(mesh, group, tri);
  if (tris) {
    if (!tris.every(flat)) return { ok: false };
  } else {
    tris = []; // flood across shared corners
    const at = new Map();
    for (let t = 0; t < nTri; t++) for (let q = 0; q < 3; q++) { const kk = key(P, I[3 * t + q]); if (!at.has(kk)) at.set(kk, []); at.get(kk).push(t); }
    const seen = new Set([tri]), todo = [tri];
    while (todo.length) { const t = todo.pop(); tris.push(t); for (let q = 0; q < 3; q++) for (const u of at.get(key(P, I[3 * t + q]))) if (!seen.has(u) && flat(u)) { seen.add(u); todo.push(u); } }
  }
  const c = new THREE.Vector3(); let A = 0;
  for (const t of tris) { const { area, mid } = get(t); c.addScaledVector(mid, area); A += area; }
  return A > 0 ? { ok: true, n: n0.clone(), c: c.divideScalar(A), tris, pts: anchors(P, I, tris, c.clone()) } : { ok: false };
}

// The points of a face that can be picked: its centre, its corners and the middle of each straight edge (mesh space).
function anchors(P, I, tris, centre) {
  const pos = new Map(), count = new Map();
  for (const t of tris) for (let q = 0; q < 3; q++) {
    const a = I[3 * t + q], b = I[3 * t + (q + 1) % 3], ka = key(P, a), kb = key(P, b), e = ka < kb ? ka + "|" + kb : kb + "|" + ka;
    pos.set(ka, pt(P, a)); pos.set(kb, pt(P, b)); count.set(e, (count.get(e) ?? 0) + 1);
  }
  const next = new Map(); // outline corner → its outline neighbours
  for (const [e, n] of count) if (n === 1) { const [a, b] = e.split("|"); for (const [x, y] of [[a, b], [b, a]]) next.set(x, [...(next.get(x) ?? []), y]); }
  const corner = new Set();
  for (const [k, nb] of next) {
    if (nb.length !== 2) { corner.add(k); continue; }
    const u = pos.get(nb[0]).clone().sub(pos.get(k)), w = pos.get(nb[1]).clone().sub(pos.get(k));
    if (u.cross(w).length() > 1e-3 * u.length() * w.length()) corner.add(k); // a straight run has no corner
  }
  const out = [{ p: centre, kind: "centre" }], done = new Set();
  for (const k of corner) {
    out.push({ p: pos.get(k), kind: "corner" });
    for (const first of next.get(k)) { // walk along the outline to the next corner: that is one straight edge
      let prev = k, cur = first;
      while (!corner.has(cur)) { const n = next.get(cur), nx = n[0] === prev ? n[1] : n[0]; prev = cur; cur = nx; }
      const id = k < cur ? k + "|" + cur : cur + "|" + k;
      if (!done.has(id)) { done.add(id); out.push({ p: pos.get(k).clone().add(pos.get(cur)).multiplyScalar(0.5), kind: "edge middle" }); }
    }
  }
  return out;
}

// The pickable point of face f closest to the click (hit.point, in world space) → { p, kind } in mesh space.
export function nearestAnchor(mesh, f, worldPoint) {
  const q = mesh.worldToLocal(worldPoint.clone());
  return f.pts.reduce((best, a) => (a.p.distanceTo(q) < best.p.distanceTo(q) ? a : best));
}

// A small ball marking the picked point (child of the mesh, so it follows it).
export function marker(mesh, p) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd400, depthTest: false }));
  m.position.copy(p); m.renderOrder = 10; m.raycast = () => {}; mesh.add(m); return m;
}

// Moves `group` (it holds meshA) so that face a lies flat on face b (the faces then look at each other).
// The part turns by the smallest angle needed, so it keeps its turn around the face normal.
export function snapTo(group, meshA, a, meshB, b) {
  group.updateMatrixWorld(true); meshA.updateMatrixWorld(true); meshB.updateMatrixWorld(true);
  const nA = a.n.clone().transformDirection(meshA.matrixWorld), nB = b.n.clone().transformDirection(meshB.matrixWorld), cB = b.c.clone().applyMatrix4(meshB.matrixWorld);
  group.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(nA, nB.negate()));
  group.updateMatrixWorld(true);
  group.position.add(cB.sub(a.c.clone().applyMatrix4(meshA.matrixWorld)));
  group.updateMatrixWorld(true);
}

// A coloured overlay on some triangles of mesh (tris = triangle numbers, null = all). It is a child of the mesh, so it follows it.
// Returns the overlay; remove it with .removeFromParent() and dispose.
export function overlayMesh(mesh, tris, color, opacity) {
  const I = mesh.geometry.index.array, idx = tris ? tris.flatMap((t) => [I[3 * t], I[3 * t + 1], I[3 * t + 2]]) : I, g = new THREE.BufferGeometry();
  g.setAttribute("position", mesh.geometry.getAttribute("position")); g.setIndex(tris ? idx : new THREE.BufferAttribute(I, 1));
  const ov = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  ov.raycast = () => {}; mesh.add(ov); return ov;
}
