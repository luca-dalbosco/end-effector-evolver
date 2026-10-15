// File writers for Export (no DOM, tested in test/export.test.js): binary STL, 3MF, and the pose of a part.
// A mesh here is { name, p: positions (x,y,z,...), i: triangle indices }.
import { zipSync, strToU8 } from "fflate";

const r4 = (x) => Math.round(x * 1e4) / 1e4;
export const xmlEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// binary STL: 80 byte header, triangle count, then 50 bytes per triangle (normal, 3 corners, 2 spare bytes)
export function stlBytes(p, t) {
  const n = t.length / 3, dv = new DataView(new ArrayBuffer(84 + 50 * n));
  dv.setUint32(80, n, true);
  let o = 84;
  const put = (x) => { dv.setFloat32(o, x, true); o += 4; }, corner = (q) => { put(p[q]); put(p[q+1]); put(p[q+2]); };
  for (let k = 0; k < n; k++) {
    const a = 3 * t[3*k], b = 3 * t[3*k+1], c = 3 * t[3*k+2];
    const ux = p[b] - p[a], uy = p[b+1] - p[a+1], uz = p[b+2] - p[a+2], wx = p[c] - p[a], wy = p[c+1] - p[a+1], wz = p[c+2] - p[a+2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
    put(nx / l); put(ny / l); put(nz / l); corner(a); corner(b); corner(c);
    o += 2; // spare bytes
  }
  return new Uint8Array(dv.buffer);
}

// 3MF: one object per mesh. The model text is written in pieces of CHUNK items, never as one huge string,
// so very large meshes do not hit the browser's string size limit.
const CHUNK = 20000;
export function threeMF(objs) {
  const enc = new TextEncoder(), parts = [];
  const put = (s) => parts.push(enc.encode(s));
  const each = (n, item) => { for (let a = 0; a < n; a += CHUNK) { let s = ""; for (let k = a; k < Math.min(n, a + CHUNK); k++) s += item(k); put(s); } };
  put(`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>`);
  objs.forEach((o, k) => {
    const p = o.p, t = o.i;
    put(`<object id="${k + 1}" type="model" name="${xmlEsc(o.name || "object")}"><mesh><vertices>`);
    each(p.length / 3, (v) => `<vertex x="${r4(p[3*v])}" y="${r4(p[3*v+1])}" z="${r4(p[3*v+2])}"/>`);
    put("</vertices><triangles>");
    each(t.length / 3, (f) => `<triangle v1="${t[3*f]}" v2="${t[3*f+1]}" v3="${t[3*f+2]}"/>`);
    put("</triangles></mesh></object>");
  });
  put(`</resources><build>${objs.map((o, k) => `<item objectid="${k + 1}"/>`).join("")}</build></model>`);
  const model = new Uint8Array(parts.reduce((s, b) => s + b.length, 0)); let at = 0;
  for (const b of parts) { model.set(b, at); at += b.length; }
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": model,
  });
}

// several meshes as STL files in one zip; file names are made safe and unique
export function stlZip(objs) {
  const files = {}, used = new Set();
  objs.forEach((o) => { const base = (o.name || "object").replace(/[^\w\- ().]+/g, "_"); let n = base, k = 2; while (used.has(n)) n = `${base}-${k++}`; used.add(n); files[n + ".stl"] = stlBytes(o.p, o.i); });
  return zipSync(files);
}

// Pose of a part as in the 3D view (three.js Euler order XYZ, radians): turn about Z, then Y, then X (all about the origin), then move.
// Returns the turns in order as [degrees, axis].
export const placeSteps = (rot) => [[rot[2], [0, 0, 1]], [rot[1], [0, 1, 0]], [rot[0], [1, 0, 0]]].map(([r, ax]) => [(r * 180) / Math.PI, ax]);
