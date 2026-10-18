import { exportSTEP, importSTEP } from "replicad";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { initKernel, buildToolStart } from "./toolStart/cad.js";
import { replyTo, meshBufs } from "./rpc.js";
import { stlBytes, threeMF, stlZip, placeSteps, placeMesh } from "./geom/export.js";
import ts from "../data/toolStart.json";
import te from "../data/toolEnd.json";

const ready = initKernel({ locateFile: () => wasmUrl });
let last = null;
const shapes = new Map(); // tool-end part id → its B-rep, kept so Export can place it and write it

const ab = (u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
function place(s, p) { // same pose as the 3D view (see placeSteps)
  let r = s.clone(); for (const [deg, ax] of placeSteps(p.rot)) r = r.rotate(deg, [0, 0, 0], ax); // each step replaces the shape, as in a chain
  return r.translate(p.pos);
}
async function exportScene(m) {
  const own = []; // copies made here, freed afterwards
  try {
    const parts = [];
    for (const it of m.items) {
      if (it.src === "mesh") { parts.push({ name: it.name, p: it.p, i: it.i }); continue; }
      const base = it.src === "start" ? last : shapes.get(it.sid);
      if (!base) throw new Error(`"${it.name}" is not in the geometry engine. Rebuild the robot side or add the part again.`);
      let b = base; const sc = it.scale ?? [1, 1, 1];
      if (it.src === "part" && sc.some((x) => x !== 1)) { // scaled part: same factor on all axes = scale the B-rep; stretched primitive = rebuild it; stretched STEP part = mesh only (no B-rep stretch in this kernel build)
        if (sc.every((x) => x === sc[0])) { b = base.scale(sc[0], [0, 0, 0]); own.push(b); }
        else if (it.kind) { const { buildPrimitive } = await import("./primitives.js"); b = buildPrimitive(it.kind, it.size, sc); own.push(b); }
        else { const me = base.mesh({ tolerance: m.tol, angularTolerance: m.ang }); parts.push({ name: it.name, p: placeMesh(me.vertices, sc, it.rot, it.pos), i: me.triangles, stretched: true }); continue; }
      }
      const s = it.src === "part" ? place(b, it) : b;
      if (s !== base) own.push(s);
      parts.push({ name: it.name, shape: s });
    }
    let data, ext = m.format, tris = 0;
    if (m.format === "step") {
      if (parts.some((p) => p.stretched)) throw new Error("A STEP part stretched unevenly (different X, Y, Z scale) cannot be written as STEP. Use STL or 3MF, or scale it evenly.");
      if (parts.some((p) => !p.shape)) throw new Error("The connector is a mesh and cannot be written as STEP. Use STL or 3MF.");
      data = await exportSTEP(parts.map((p) => ({ shape: p.shape, name: p.name })), { unit: "MM", modelUnit: "MM" }).arrayBuffer();
    } else {
      const ms = parts.map((p) => { if (!p.shape) return { name: p.name, p: p.p, i: p.i }; const me = p.shape.mesh({ tolerance: m.tol, angularTolerance: m.ang }); return { name: p.name, p: me.vertices, i: me.triangles }; });
      tris = ms.reduce((n, o) => n + o.i.length / 3, 0);
      if (m.format === "3mf") data = ab(threeMF(ms));
      else if (ms.length === 1) data = ab(stlBytes(ms[0].p, ms[0].i));
      else { data = ab(stlZip(ms)); ext = "zip"; }
    }
    const file = ext === "zip" ? `${m.base}_stl.zip` : `${m.base}.${ext}`;
    replyTo(m, { ok: true, file, data, info: { objects: parts.length, tris, bytes: data.byteLength } }, [data]);
  } catch (err) { replyTo(m, { ok: false, error: String(err?.message ?? err) }); }
  finally { own.forEach((s) => s.delete?.()); }
}

// view mesh of a B-rep, with plain typed arrays the main thread can take over
const viewMesh = (s, q) => { const me = s.mesh({ tolerance: q.toleranceMm, angularTolerance: (q.angleDeg * Math.PI) / 180 });
  return { me, mesh: { p: Float32Array.from(me.vertices), n: Float32Array.from(me.normals), i: Uint32Array.from(me.triangles) } }; };

const handlers = {
  async import(m) { return addPart(m, await importSTEP(new Blob([m.data]))); },
  async primitive(m) { const { buildPrimitive } = await import("./primitives.js"); return addPart(m, buildPrimitive(m.kind, m.size, m.scale)); },
  drop(m) { shapes.get(m.sid)?.delete?.(); shapes.delete(m.sid); },
  exportScene,
  build(m) {
    const r = buildToolStart(m.flange, m.settings);
    if (!r.ok) return replyTo(m, { ok: false, errors: r.errors, warnings: r.warnings });
    last?.delete?.(); last = r.shape; // the old robot side is freed (OpenCascade memory is not garbage collected)
    const { mesh } = viewMesh(last, ts.viewMesh), d = r.dims;
    replyTo(m, { ok: true, warnings: r.warnings, mesh,
      dims: { plateOuter: d.plateOuter, holeD: d.holeD, headD: d.headD, seatLength: d.seat.length, bore: d.bore, depth: d.depth, collarOuter: d.collarOuter,
              thickness: d.plateThickness, spigotOuter: d.spigotOuter, centreHole: d.centreHole, screws: d.screws, pinHole: d.hasPin && d.pinLength === null, dowelD: d.dowelD } }, meshBufs(mesh));
  },
};
function addPart(m, s) { // a tool-end part: keep its B-rep under its id, send the view mesh and the face ranges
  const { me, mesh } = viewMesh(s, te.viewMesh);
  shapes.get(m.sid)?.delete?.(); shapes.set(m.sid, s);
  replyTo(m, { ok: true, name: m.name, kind: m.kind, sid: m.sid, fg: me.faceGroups, mesh }, meshBufs(mesh));
}

onmessage = async (e) => {
  const m = e.data, h = handlers[m.type]; if (!h) return;
  try { await ready; await h(m); }
  catch (err) { replyTo(m, { ok: false, error: String(err?.message ?? err), errors: [String(err?.message ?? err)], warnings: [] }); }
};