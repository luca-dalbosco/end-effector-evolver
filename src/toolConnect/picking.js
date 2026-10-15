// Connect faces (green) and avoid items (red) on the tool objects: click tool, the three lists, the 3D overlays,
// and the world-space triangles sent to the worker.
import * as THREE from "three";
import tc from "../../data/toolConnect.json";
import { help, segmented, pick } from "../ui.js";
import { record } from "../history.js";
import { head, btn, numRow } from "./rows.js";

export function initPicking(C, host) {
  const { S, list, cam, dom } = C;
  const picked = (C.picked = []); // green faces on any tool object: { key, it (list row), obj (its 3D group), fi (face), ov (green overlay) }
  const avoid = (C.avoid = []); // red items: { key, kind: "obj" | "face", it (list row), obj (its 3D group), fi (face), mm, ov (red overlay) }
  let clickMode = "connect";
  const after = () => { C.renderAvoid(); C.sync(); C.schedule(); };

  // ---------- panel ----------
  head(host, "Robot side surface");
  const sel = document.createElement("select");
  tc.toolStartConnection.options.forEach((o) => sel.add(new Option(o.label, o.id)));
  sel.onchange = pick(sel, "Robot side surface", () => S.conn, (v) => { S.conn = v; C.sync(); C.schedule(); });
  host.append(sel);
  C.refreshers.push(() => (sel.value = S.conn));

  head(host, "Click tool").append(help("clickTool"));
  const tool = segmented([{ id: "connect", label: "Connect face" }, { id: "face", label: "Avoid face" }, { id: "object", label: "Avoid object" }], (id) => { clickMode = id; });
  tool.set(clickMode); host.append(tool.el);

  // undo: the green and red items are kept as a list of {kind, object, face}; restore() rebuilds the overlays
  const snap = () => ({ p: picked.map((x) => ({ it: x.it, fi: x.fi, key: x.key })), a: avoid.map((x) => ({ kind: x.kind, it: x.it, fi: x.fi, key: x.key })) });
  const same = (x, y) => x.p.map((q) => q.key).join() === y.p.map((q) => q.key).join() && x.a.map((q) => q.key).join() === y.a.map((q) => q.key).join();
  function restore(sn) {
    picked.splice(0).forEach(dropEntry); avoid.splice(0).forEach(dropEntry);
    const live = (x) => list.items().includes(x.it);
    sn.p.filter(live).forEach((x) => addPick(x.it, x.fi)); sn.a.filter(live).forEach((x) => addAvoid(x.kind, x.it, x.fi));
    after();
  }
  function act(label, fn) { // one undo step for a change of the green / red items
    const b = snap(); fn(); after();
    const a = snap(); if (!same(a, b)) record(label, () => restore(b), () => restore(a));
  }

  // ---------- summary and reset buttons ----------
  const box = () => { const d = document.createElement("div"); d.style.cssText = "font-size:12px"; return d; };
  head(host, "Connection and avoid");
  const connBox = box(), avBox = box();
  connBox.style.marginBottom = "4px"; avBox.style.margin = "10px 0 4px";
  host.append(connBox, btn("Reset connection faces", () => act("Reset connection faces", () => picked.splice(0).forEach(dropEntry))));
  host.append(avBox, btn("Reset avoided", () => act("Reset avoided", () => avoid.splice(0).forEach(dropEntry))));
  const gaps = document.createElement("div"); gaps.style.marginTop = "10px"; host.append(gaps);
  numRow(C, gaps, "Avoided objects gap (mm)", tc.avoid.objectGrowMm, "gapObj", undefined, undefined, "gapObjects");
  numRow(C, gaps, "Avoided faces gap (mm)", tc.avoid.faceExtrudeMm, "gapFace", undefined, undefined, "gapFaces");
  const looseBox = box(); host.append(looseBox);

  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  C.renderAvoid = () => {
    prunePicked(); pruneAvoid(); looseBox.textContent = "";
    const fc = avoid.filter((x) => x.kind === "face").length, oc = avoid.length - fc;
    connBox.textContent = picked.length ? `Connected: ${n(picked.length, "face", "faces")}` : "Connected: 0 faces. Pick \"Connect face\" above and click a face of a tool object.";
    avBox.textContent = avoid.length ? `Avoided: ${n(fc, "face", "faces")}, ${n(oc, "object", "objects")}` : "Avoided: 0 faces, 0 objects";
    const loose = list.items().filter((i) => i.deletable !== false && !picked.some((p) => p.it === i) && !avoid.some((en) => en.it === i));
    if (loose.length) {
      const w = document.createElement("div"); w.className = "warn"; w.style.marginTop = "6px";
      w.textContent = `⚠ Not connected and not avoided: ${loose.map((i) => i.name).join(", ")}. The connector may grow through ${loose.length > 1 ? "them" : "it"}. Use "Avoid object" to keep it clear.`;
      looseBox.append(w);
    }
  };

  // ---------- clicks in the 3D view ----------
  const hlMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const avMat = new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  const baseMesh = (o) => o.children.find((c) => c.userData.base);
  const shown = () => list.items().filter((i) => i.object.visible && baseMesh(i.object));
  function pickAt(its) { // nearest hit among the main meshes of these list rows
    const ms = its.map((i) => { i.object.updateMatrixWorld(true); return baseMesh(i.object); });
    const hit = ray.intersectObjects(ms, false)[0]; return hit ? { it: its[ms.indexOf(hit.object)], hit } : null;
  }
  function faceAt(obj, hit) {
    const { fg, k } = faceInfo(obj), t3 = hit.faceIndex * 3;
    return fg.findIndex((g) => t3 >= (g.start / k) * 3 && t3 < ((g.start + g.count) / k) * 3);
  }
  dom.addEventListener("pointerup", (e) => {
    if (C.tab !== "C" || C.running || (e.button !== 0 && e.button !== 2) || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    prunePicked(); pruneAvoid();
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam);
    const pickable = (i) => i.deletable !== false; // the flange is never pickable here
    const h = pickAt(shown().filter(pickable)); if (!h) return;
    if (e.button === 2) { // right-click: clear whatever is under the cursor (green face, red face, red object)
      const fi = faceAt(h.it.object, h.hit);
      return act("Clear " + h.it.name, () => { if (fi >= 0) { removePick(h.it, fi); removeAvoid("face", h.it, fi); } removeAvoid("obj", h.it, null); });
    }
    const mode = e.shiftKey ? (clickMode === "object" ? "object" : "face") : clickMode; // shift-click = quick avoid
    if (mode === "object") return act("Avoid object " + h.it.name, () => toggleAvoid("obj", h.it, null));
    if (!(h.it.object.userData.fg || []).length) return C.setInfo("bad", "✖ This part has no face data. Re-add it in step 2.");
    const fi = faceAt(h.it.object, h.hit); if (fi < 0) return;
    act(`${mode === "connect" ? "Connect" : "Avoid"} face ${fi + 1} of ${h.it.name}`, () => (mode === "connect" ? toggleConnect(h.it, fi) : toggleAvoid("face", h.it, fi)));
  });
  function dropEntry(en) { if (en.ov) { en.ov.parent?.remove(en.ov); en.ov.geometry.dispose(); en.ov = null; } }
  // forget entries of deleted rows, or whose mesh was replaced
  const prune = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { const en = arr[i]; if (!list.items().includes(en.it) || en.it.object !== en.obj) { dropEntry(en); arr.splice(i, 1); } } };
  const prunePicked = () => prune(picked), pruneAvoid = () => prune(avoid);
  function removePick(it, fi) { // fi null = every green face of this object
    for (let i = picked.length - 1; i >= 0; i--) if (picked[i].it === it && (fi == null || picked[i].fi === fi)) { dropEntry(picked[i]); picked.splice(i, 1); }
  }
  function removeAvoid(kind, it, fi) {
    const at = avoid.findIndex((x) => x.key === kind + ":" + it.id + ":" + fi);
    if (at >= 0) { dropEntry(avoid[at]); avoid.splice(at, 1); }
  }
  const overlay = (en, index, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", baseMesh(en.obj).geometry.getAttribute("position")); g.setIndex(index); en.ov = new THREE.Mesh(g, mat); en.obj.add(en.ov); };
  function toggleConnect(it, fi) { // a face cannot be both green and red: the last click wins
    const key = "c:" + it.id + ":" + fi, at = picked.findIndex((x) => x.key === key);
    if (at >= 0) { dropEntry(picked[at]); picked.splice(at, 1); return; }
    removeAvoid("face", it, fi); removeAvoid("obj", it, null);
    addPick(it, fi);
  }
  function addPick(it, fi) {
    const en = { key: "c:" + it.id + ":" + fi, it, obj: it.object, fi, ov: null };
    overlay(en, faceIndices(en.obj, [fi]), hlMat); picked.push(en);
  }
  function toggleAvoid(kind, it, fi) { // a face cannot be both green and red: picking red removes green
    const key = kind + ":" + it.id + ":" + fi, at = avoid.findIndex((x) => x.key === key);
    if (at >= 0) { dropEntry(avoid[at]); avoid.splice(at, 1); return; }
    if (kind === "obj") removePick(it, null); else removePick(it, fi);
    addAvoid(kind, it, fi);
  }
  function addAvoid(kind, it, fi) {
    const en = { key: kind + ":" + it.id + ":" + fi, kind, it, obj: it.object, fi, ov: null };
    overlay(en, kind === "obj" ? baseMesh(en.obj).geometry.index : faceIndices(en.obj, [fi]), avMat); avoid.push(en);
  }

  // ---------- triangles for the worker ----------
  function faceInfo(part) { // replicad gives face ranges in index units; k also accepts triangle units
    const mesh = part.children[0], fg = part.userData.fg || [], nTri = mesh.geometry.index.count / 3;
    return { mesh, fg, k: fg.reduce((m, g) => Math.max(m, g.start + g.count), 0) > nTri ? 3 : 1 };
  }
  function faceIndices(part, fis) {
    const { mesh, fg, k } = faceInfo(part), src = mesh.geometry.index.array, idx = [];
    fis.forEach((fi) => { const g = fg[fi], a = (g.start / k) * 3, b = a + (g.count / k) * 3; for (let i = a; i < b; i++) idx.push(src[i]); });
    return idx;
  }
  const range = (g, k) => [(g.start / k) * 3, ((g.start + g.count) / k) * 3]; // index range of one face
  function trisOf(mesh, ranges) { // world-space triangles (9 numbers each); ranges = [[firstIndex, lastIndex+1], ...] or null for all
    const pos = mesh.geometry.getAttribute("position"), idx = mesh.geometry.index.array, v = new THREE.Vector3(), out = [];
    for (const [a, b] of ranges ?? [[0, idx.length]]) for (let i = a; i < b; i++) { v.fromBufferAttribute(pos, idx[i]).applyMatrix4(mesh.matrixWorld); out.push(v.x, v.y, v.z); }
    return Float32Array.from(out);
  }
  C.endTris = (all) => { // world-space triangles of every connected object (all) or of its green faces only
    const out = [];
    for (const it of new Set(picked.map((p) => p.it))) {
      it.object.updateMatrixWorld(true);
      const { mesh, fg, k } = faceInfo(it.object);
      out.push(trisOf(mesh, all ? null : picked.filter((p) => p.it === it).map((p) => range(fg[p.fi], k))));
    }
    const res = new Float32Array(out.reduce((s, a) => s + a.length, 0)); let o = 0;
    out.forEach((a) => { res.set(a, o); o += a.length; });
    return res;
  };
  C.avoidData = () => { // world-space triangles of every red item, and their buffers to hand over
    pruneAvoid();
    const items = [], tr = [];
    for (const en of avoid) {
      en.obj.updateMatrixWorld(true);
      const { mesh, fg, k } = faceInfo(en.obj);
      const t = trisOf(mesh, en.kind === "obj" ? null : [range(fg[en.fi], k)]);
      items.push({ kind: en.kind, mm: en.kind === "face" ? S.gapFace : S.gapObj, tris: t }); tr.push(t.buffer);
    }
    return { items, tr };
  };
  C.startTris = (info, all) => { // all = whole tool start; otherwise only its top face (z = plate thickness)
    const { v, n, t } = info.mesh, z0 = info.dims.thickness, out = [];
    for (let i = 0; i < t.length; i += 3) {
      const q = [t[i], t[i + 1], t[i + 2]];
      if (!all && (n[q[0] * 3 + 2] < 0.9 || q.some((x) => Math.abs(v[x * 3 + 2] - z0) > 1e-3))) continue;
      for (const x of q) out.push(v[x * 3], v[x * 3 + 1], v[x * 3 + 2]);
    }
    return Float32Array.from(out);
  };
  C.isAvoided = (it) => avoid.some((en) => en.it === it);
}
