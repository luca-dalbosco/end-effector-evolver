// Primitive solids as true B-rep (not meshes), centred on the origin. Sizes in mm.
import * as R from "replicad";

const PHI = (1 + Math.sqrt(5)) / 2;
const key = (v) => v.map((x) => x.toFixed(6)).join();
const uniq = (list) => [...new Map(list.map((v) => [key(v), v])).values()];
const signs = (p) => p.reduce((out, x) => (x === 0 ? out.map((v) => [...v, 0]) : out.flatMap((v) => [[...v, x], [...v, -x]])), [[]]);
const gen = (p) => uniq([p, [p[2], p[0], p[1]], [p[1], p[2], p[0]]].flatMap(signs));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

// Each solid = its corner points + the directions its flat faces point to.
const SOLIDS = {
  tetrahedron: () => { const V = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]; return [V, V.map((v) => v.map((x) => -x))]; },
  cube: () => [gen([1, 1, 1]), gen([1, 0, 0])],
  octahedron: () => [gen([1, 0, 0]), gen([1, 1, 1])],
  icosahedron: () => [gen([0, 1, PHI]), gen([1, 1, 1]).concat(gen([1 / PHI, 0, PHI]))],
  dodecahedron: () => [gen([1, 1, 1]).concat(gen([0, 1 / PHI, PHI])), gen([1, 0, PHI])],
  cuboctahedron: () => [gen([1, 1, 0]), gen([1, 1, 1]).concat(gen([1, 0, 0]))],
};

// Corners of one face, ordered counter-clockwise seen from outside.
function faceOf(V, n) {
  const u = unit(n), mx = Math.max(...V.map((v) => dot(v, u)));
  const pts = V.filter((v) => dot(v, u) > mx - 1e-6);
  const c = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);
  const t1 = unit(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), t2 = cross(u, t1);
  const ang = (p) => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return Math.atan2(dot(d, t2), dot(d, t1)); };
  return pts.sort((a, b) => ang(a) - ang(b));
}

export function buildPrimitive(kind, size) {
  if (!(size > 0)) throw new Error("Size must be above 0.");
  const r = size / 2;
  if (kind === "cylinder") return R.makeCylinder(r, size, [0, 0, -r], [0, 0, 1]);
  if (kind === "sphere") return R.makeSphere(r);
  if (kind === "cone") {
    const pts = [[0, -r], [r, -r], [0, r]];
    let pen = R.draw(pts[0]); for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
    return pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]);
  }
  const make = SOLIDS[kind]; if (!make) throw new Error("Unknown primitive: " + kind);
  const [V, N] = make();
  const k = kind === "cube" ? r : r / Math.max(...V.map((v) => Math.hypot(...v))); // cube: edge = size; others: overall diameter = size
  const faces = N.map((n) => R.makePolygon(faceOf(V, n).map((p) => p.map((x) => x * k))));
  return R.makeSolid(faces);
}