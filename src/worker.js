import { zipSync, strToU8 } from "fflate";
import { exportSTEP, importSTEP } from "replicad";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { initKernel, buildToolStart } from "./toolStart.js";
// import { buildPrimitive } from "./primitives.js";

const ready = initKernel({ locateFile: () => wasmUrl });
let last = null;
let imp = null;

function threeMF(v, tr) {
  const verts = []; for (let i = 0; i < v.length; i += 3) verts.push(`<vertex x="${v[i]}" y="${v[i+1]}" z="${v[i+2]}"/>`);
  const tris = []; for (let i = 0; i < tr.length; i += 3) tris.push(`<triangle v1="${tr[i]}" v2="${tr[i+1]}" v3="${tr[i+2]}"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": strToU8(model),
  });
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === "import" || m.type === "primitive") {
    try {
      await ready;
      if (imp?.delete) imp.delete();
      const { buildPrimitive } = m.type === "primitive" ? await import("./primitives.js") : {};
      imp = m.type === "import" ? await importSTEP(new Blob([m.data])) : buildPrimitive(m.kind, m.size);
      const me = imp.mesh({ tolerance: 0.05, angularTolerance: 0.2 });
      postMessage({ imported: true, ok: true, name: m.name, kind: m.kind, keep: m.keep,
        mesh: { v: Float32Array.from(me.vertices), n: Float32Array.from(me.normals), t: Uint32Array.from(me.triangles) } });
    } catch (err) { imp = null; postMessage({ imported: true, ok: false, error: String(err) }); }
    return;
  }
  try {
    await ready;
    if (m.type === "build") {
      const r = buildToolStart(m.flange, m.settings);
      if (!r.ok) return postMessage({ id: m.id, ok: false, errors: r.errors, warnings: r.warnings });
      last = r.shape;
      const me = last.mesh({ tolerance: 0.03, angularTolerance: 0.15 });
      const d = r.dims;
      postMessage({ id: m.id, ok: true, warnings: r.warnings,
        dims: { plateOuter: d.plateOuter, holeD: d.holeD, headD: d.headD, seatLength: d.seat.length, bore: d.bore, depth: d.depth, collarOuter: d.collarOuter },
        mesh: { v: Float32Array.from(me.vertices), n: Float32Array.from(me.normals), t: Uint32Array.from(me.triangles) } });
    } else if (m.type === "export" && last) {
      let data;
      if (m.format === "step") data = await exportSTEP([{ shape: last, name: "tool_start" }], { unit: "MM", modelUnit: "MM" }).arrayBuffer();
      else if (m.format === "stl") data = await last.blobSTL({ tolerance: 0.01, angularTolerance: 0.1 }).arrayBuffer();
      else { const me = last.mesh({ tolerance: 0.01, angularTolerance: 0.1 }); data = threeMF(me.vertices, me.triangles).buffer; }
      postMessage({ id: m.id, exported: true, format: m.format, data }, [data]);
    }
  } catch (err) { postMessage({ id: m.id, ok: false, errors: [String(err)], warnings: [] }); }
};