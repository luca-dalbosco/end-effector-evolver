import { zipSync, strToU8 } from "fflate";
import { exportSTEP, importSTEP } from "replicad";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { initKernel, buildToolStart } from "./toolStart.js";
// import { buildPrimitive } from "./primitives.js";

const ready = initKernel({ locateFile: () => wasmUrl });
let last = null;
const shapes = new Map(); // tool-end part id → its B-rep, kept so Export can place it and write it

const r4 = (x) => Math.round(x * 1e4) / 1e4, esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function threeMF(objs) { // objs: [{name, v, t}] → one 3MF with one object each
  const res = objs.map((o, k) => {
    const verts = []; for (let i = 0; i < o.v.length; i += 3) verts.push(`<vertex x="${r4(o.v[i])}" y="${r4(o.v[i+1])}" z="${r4(o.v[i+2])}"/>`);
    const tris = []; for (let i = 0; i < o.t.length; i += 3) tris.push(`<triangle v1="${o.t[i]}" v2="${o.t[i+1]}" v3="${o.t[i+2]}"/>`);
    return `<object id="${k + 1}" type="model" name="${esc(o.name || "object")}"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`;
  });
  const items = objs.map((o, k) => `<item objectid="${k + 1}"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${res.join("")}</resources><build>${items}</build></model>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": strToU8(model),
  });
}
function stlBytes(v, t) { // binary STL
  const n = t.length / 3, dv = new DataView(new ArrayBuffer(84 + 50 * n));
  dv.setUint32(80, n, true);
  for (let k = 0; k < n; k++) {
    const a = 3 * t[3*k], b = 3 * t[3*k+1], c = 3 * t[3*k+2];
    const ux = v[b] - v[a], uy = v[b+1] - v[a+1], uz = v[b+2] - v[a+2], wx = v[c] - v[a], wy = v[c+1] - v[a+1], wz = v[c+2] - v[a+2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
    let o = 84 + 50 * k;
    for (const x of [nx / l, ny / l, nz / l, v[a], v[a+1], v[a+2], v[b], v[b+1], v[b+2], v[c], v[c+1], v[c+2]]) { dv.setFloat32(o, x, true); o += 4; }
  }
  return new Uint8Array(dv.buffer);
}
const ab = (u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
function place(s, p) { // same pose as the 3D view: rotation (three.js XYZ Euler, radians), then position
  const d = 180 / Math.PI, o = [0, 0, 0];
  return s.clone().rotate(p.rot[2] * d, o, [0, 0, 1]).rotate(p.rot[1] * d, o, [0, 1, 0]).rotate(p.rot[0] * d, o, [1, 0, 0]).translate(p.pos);
}
async function exportScene(m) {
  const own = []; // copies made here, freed afterwards
  try {
    const parts = m.items.map((it) => {
      if (it.src === "mesh") return { name: it.name, v: it.v, t: it.t };
      const base = it.src === "start" ? last : shapes.get(it.sid);
      if (!base) throw new Error(`"${it.name}" is not in the geometry engine. Rebuild the tool start or add the part again.`);
      const s = it.src === "part" ? place(base, it) : base;
      if (s !== base) own.push(s);
      return { name: it.name, shape: s };
    });
    let data, ext = m.format, tris = 0;
    if (m.format === "step") {
      if (parts.some((p) => !p.shape)) throw new Error("The connector is a mesh and cannot be written as STEP. Use STL or 3MF.");
      data = await exportSTEP(parts.map((p) => ({ shape: p.shape, name: p.name })), { unit: "MM", modelUnit: "MM" }).arrayBuffer();
    } else {
      const ms = parts.map((p) => { if (!p.shape) return p; const me = p.shape.mesh({ tolerance: m.tol, angularTolerance: m.ang }); return { name: p.name, v: me.vertices, t: me.triangles }; });
      tris = ms.reduce((n, o) => n + o.t.length / 3, 0);
      if (m.format === "3mf") data = ab(threeMF(ms));
      else if (ms.length === 1) data = ab(stlBytes(ms[0].v, ms[0].t));
      else {
        const files = {}, used = new Set();
        ms.forEach((o) => { const base = (o.name || "object").replace(/[^\w\- ().]+/g, "_"); let n = base, k = 2; while (used.has(n)) n = `${base}-${k++}`; used.add(n); files[n + ".stl"] = stlBytes(o.v, o.t); });
        data = ab(zipSync(files)); ext = "zip";
      }
    }
    const file = ext === "zip" ? `${m.base}_stl.zip` : `${m.base}.${ext}`;
    postMessage({ exportedScene: true, xid: m.xid, ok: true, file, data, info: { objects: parts.length, tris, bytes: data.byteLength } }, [data]);
  } catch (err) { postMessage({ exportedScene: true, xid: m.xid, ok: false, error: String(err?.message ?? err) }); }
  finally { own.forEach((s) => s.delete?.()); }
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === "import" || m.type === "primitive") {
    try {
      await ready;
      const { buildPrimitive } = m.type === "primitive" ? await import("./primitives.js") : {};
      const s = m.type === "import" ? await importSTEP(new Blob([m.data])) : buildPrimitive(m.kind, m.size);
      const me = s.mesh({ tolerance: 0.05, angularTolerance: 0.2 });
      shapes.get(m.sid)?.delete?.(); shapes.set(m.sid, s);
      postMessage({ imported: true, ok: true, name: m.name, kind: m.kind, keep: m.keep, sid: m.sid, fg: me.faceGroups,
        mesh: { v: Float32Array.from(me.vertices), n: Float32Array.from(me.normals), t: Uint32Array.from(me.triangles) } });
    } catch (err) { postMessage({ imported: true, ok: false, error: String(err) }); }
    return;
  }
  if (m.type === "drop") { shapes.get(m.sid)?.delete?.(); shapes.delete(m.sid); return; }
  if (m.type === "exportScene") { await ready; return exportScene(m); }
  try {
    await ready;
    if (m.type === "build") {
      const r = buildToolStart(m.flange, m.settings);
      if (!r.ok) return postMessage({ id: m.id, ok: false, errors: r.errors, warnings: r.warnings });
      last = r.shape;
      const me = last.mesh({ tolerance: 0.03, angularTolerance: 0.15 });
      const d = r.dims;
      postMessage({ id: m.id, ok: true, warnings: r.warnings,
        dims: { plateOuter: d.plateOuter, holeD: d.holeD, headD: d.headD, seatLength: d.seat.length, bore: d.bore, depth: d.depth, collarOuter: d.collarOuter,
                thickness: d.plateThickness, spigotOuter: d.spigotOuter, centreHole: d.centreHole, screws: d.screws, pinHole: d.hasPin && d.pinLength === null, dowelD: d.dowelD },
        mesh: { v: Float32Array.from(me.vertices), n: Float32Array.from(me.normals), t: Uint32Array.from(me.triangles) } });
    } else if (m.type === "export" && last) {
      let data;
      if (m.format === "step") data = await exportSTEP([{ shape: last, name: "tool_start" }], { unit: "MM", modelUnit: "MM" }).arrayBuffer();
      else if (m.format === "stl") data = await last.blobSTL({ tolerance: 0.01, angularTolerance: 0.1 }).arrayBuffer();
      else { const me = last.mesh({ tolerance: 0.01, angularTolerance: 0.1 }); data = ab(threeMF([{ name: "tool_start", v: me.vertices, t: me.triangles }])); }
      postMessage({ id: m.id, exported: true, format: m.format, data }, [data]);
    }
  } catch (err) { postMessage({ id: m.id, ok: false, errors: [String(err)], warnings: [] }); }
};