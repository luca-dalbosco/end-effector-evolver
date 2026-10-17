// Stage B: Tool End. Import STEP parts or add primitives (as many as you like), show them next to the tool start,
// move/rotate the one selected in the object list (or clicked in the 3D view) with a gizmo.
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import te from "../data/toolEnd.json";
import { section, help, numberRow, segmented } from "./ui.js";
import { record, isReplaying } from "./history.js";
import { meshFrom, onViewClick } from "./viewer.js";
import { initHover } from "./hover.js";
import { faceAt, snapTo, overlayMesh, nearestAnchor, marker } from "./faceSnap.js";

export function initToolEnd({ scene, cam, renderer, orbit, geo, $, list, view }) {
  const refreshers = [], refresh = () => refreshers.forEach((f) => f()); // this stage's rows only (a gizmo drag refreshes them on every move)
  const limit = te.maxFileSizeMB.default; // internal limit: edit it in data/toolEnd.json, not shown in the UI
  let part = null, partKind = null, cur = null, stage = "A", primKind = te.primitives[0].id, primSize = te.primitiveSize.default, primScale = [1, 1, 1];
  const mine = []; // list entries that are tool-end parts (the flange is not in here)
  let sidN = 0; // each part gets an id; the worker keeps its B-rep under it
  const dom = renderer.domElement;
  let dropUp = null; // position/rotation drop-up in the 3D view

  // ---------- panel (shown only in stage B) ----------
  const panel = document.createElement("div"); panel.style.display = "none"; $("exportA").after(panel);
  document.addEventListener("stage", (e) => { stage = e.detail; panel.style.display = stage === "B" ? "" : "none"; syncGizmo(); });
  const add = section("Add objects"); panel.append(add.box); const body = add.body;
  const blk = (title) => { const d = document.createElement("div"); d.style.cssText = "margin:12px 0 0;padding-top:10px;border-top:1px solid var(--line)"; const h = document.createElement("div"); h.textContent = title; h.style.cssText = "font-weight:600;margin-bottom:6px"; d.append(h); body.append(d); return d; };
  const btn = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; return b; };

  // ---------- gizmo: move arrows + rotate rings together (two controls on the same object) ----------
  const gT = new TransformControls(cam, dom), gR = new TransformControls(cam, dom), gizmos = [gT, gR], helpers = gizmos.map((g) => g.getHelper());
  gR.setMode("rotate"); gT.setSize(0.8); gR.setSize(1.2); // arrows inside, rings outside (tune these two numbers if you like)
  try { // no free-rotate ball and no outer ring: they would cover the arrows
    for (const grp of [gR._gizmo.gizmo.rotate, gR._gizmo.picker.rotate]) [...grp.children].filter((c) => c.name === "XYZE" || c.name === "E").forEach((c) => grp.remove(c));
  } catch (err) { /* harmless: the gizmo just keeps its extra handles */ }
  helpers.forEach((h) => { h.visible = false; scene.add(h); });
  const pose = (o) => ({ p: o.position.clone(), r: o.rotation.clone() }), setPose = (o, q) => { o.position.copy(q.p); o.rotation.copy(q.r); refresh(); };
  let dragFrom = null, dragObj = null;
  gizmos.forEach((g, i) => {
    g.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
      if (e.value) { dragObj = part; dragFrom = part ? pose(part) : null; return; }
      if (!dragFrom || !dragObj) return;
      const o = dragObj, b = dragFrom, a = pose(o); dragFrom = dragObj = null;
      if (a.p.equals(b.p) && a.r.equals(b.r)) return;
      const nm = mine.find((m) => m.object === o)?.name ?? "part";
      record(`${i ? "Rotate" : "Move"} ${nm}`, () => setPose(o, b), () => setPose(o, a));
    });
    g.addEventListener("objectChange", refresh);
  });
  function syncGizmo() { const on = stage === "B"; gizmos.forEach((g) => (g.enabled = on)); helpers.forEach((h) => (h.visible = on && !!part)); if (dropUp) dropUp.style.display = on && part ? "" : "none"; }
  // where an arrow and a ring overlap, the arrow wins (so only one of the two reacts to the mouse)
  const ptr = (e) => { const r = dom.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: (-(e.clientY - r.top) / r.height) * 2 + 1, button: e.button }; };
  function arbitrate(e) {
    if (stage !== "B" || !part || gT.dragging || gR.dragging) return;
    gizmos.forEach((g) => (g.enabled = true));
    gT.pointerHover(ptr(e)); gR.pointerHover(ptr(e));
    if (gT.axis && gR.axis) { gR.axis = null; gR.enabled = false; }
  }
  dom.addEventListener("pointermove", arbitrate, true); dom.addEventListener("pointerdown", arbitrate, true);

  // ---------- click an object in the 3D view (stage B) to select it ----------
  onViewClick(dom, cam, (e, ray) => {
    if (stage !== "B" || e.button !== 0 || gT.axis || gR.axis) return;
    const targets = list.items().filter((i) => i.object.visible);
    const meshes = targets.map((i) => i.object.children.find((c) => c.userData.base)).filter(Boolean);
    const hit = ray.intersectObjects(meshes, false)[0]; if (!hit) return;
    const it = targets.find((i) => i.object.children.includes(hit.object)); if (!it) return;
    if (snap) return snapClick(it, hit);
    list.select(it);
  });

  // ---------- snap faces: click a face of the part to move, then the face it should stick to ----------
  let snap = null; // null = off, otherwise { a } once the first face is picked
  const snapBtn = btn("Snap faces", () => (snap ? endSnap("") : startSnap()));
  function startSnap() { snap = {}; snapBtn.textContent = "Cancel snapping"; say("", "Click a flat face of the part you want to move. Click near its middle, a corner or the middle of an edge to pick that point."); }
  function endSnap(text, cls = "") { if (snap?.a) { for (const m of [snap.a.ov, snap.a.mk]) { m.removeFromParent(); m.geometry.dispose(); } } snap = null; snapBtn.textContent = "Snap faces"; say(cls, text); }
  function snapClick(it, hit) {
    const f = faceAt(hit.object, it.object, hit.faceIndex); if (!f.ok) return say("bad", "✖ Only flat faces can snap. Click a flat face.");
    const an = nearestAnchor(hit.object, f, hit.point); f.c = an.p; // from here on the face's "centre" is the picked point
    if (!snap.a) {
      if (!mine.includes(it)) return say("bad", "✖ First click a face of the part to move (the robot side cannot move).");
      list.select(it); snap.a = { it, f, mesh: hit.object, ov: overlayMesh(hit.object, f.tris, 0x2e9e4f, 0.7), mk: marker(hit.object, an.p), kind: an.kind };
      return say("", `Picked the ${an.kind}. Now click the face it should stick to (on another object), near the point it should meet.`);
    }
    if (it === snap.a.it) return say("bad", "✖ Pick a face on a different object.");
    const o = snap.a.it.object, b = pose(o); snapTo(o, snap.a.mesh, snap.a.f, hit.object, f);
    const a = pose(o); setPose(o, a); // refresh the number boxes
    record("Snap " + snap.a.it.name, () => setPose(o, b), () => setPose(o, a));
    endSnap(`✔ Snapped (${snap.a.kind} to ${an.kind}). Move or rotate it with the arrows if needed.`, "ok");
  }
  document.addEventListener("stage", () => snap && endSnap(""));
  // while snapping: show the face and the point a click would pick (only where a click is allowed)
  initHover({ dom, cam, active: () => !!snap && stage === "B",
    targets: () => list.items().filter((i) => i.object.visible).map((i) => ({ it: i, mesh: i.object.children.find((c) => c.userData.base) })).filter((t) => t.mesh),
    describe: ({ it, mesh }, hit) => {
      if (snap.a ? it === snap.a.it : !mine.includes(it)) return null;
      const f = faceAt(mesh, it.object, hit.faceIndex); if (!f.ok) return null;
      const an = nearestAnchor(mesh, f, hit.point);
      return { key: `${mesh.uuid}:${f.tris[0]}:${an.p.toArray()}`, tris: f.tris, color: 0x2e9e4f, point: an.p };
    } });

  // ---------- parts in the scene ----------
  const msg = document.createElement("div"); msg.style.cssText = "font-size:12px;margin:6px 0";
  const say = (cls, text) => { msg.innerHTML = ""; const d = document.createElement("div"); d.className = cls; d.textContent = text; msg.append(d); };
  const mat = new THREE.MeshStandardMaterial({ color: 0xd98c3f, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
  const free = (obj) => obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  const attachAll = (obj) => gizmos.forEach((g) => (obj ? g.attach(obj) : g.detach()));

  // called by the list when a row is selected (or an object is clicked in the 3D view)
  function choose(it) {
    cur = it && mine.includes(it) ? it : null; // the flange row selects nothing here
    part = cur ? cur.object : null; partKind = cur ? cur.kind : null;
    attachAll(part);
    if (cur?.kind) { primKind = cur.kind; primSize = cur.size; primScale = [...cur.scale]; kindSel.value = primKind; } // dropdown and size show the selected primitive
    syncGizmo(); refresh();
  }
  list.onSelect(choose);

  function setPart(m, name, kind, sid) { // sid = id of the B-rep kept in the worker (Export uses it)
    const mesh = meshFrom(m, mat.clone()); mesh.userData.base = true; // "base" = the mesh the list makes transparent
    const grp = new THREE.Group(); grp.userData.fg = m.fg; grp.add(mesh);
    const it = list.add({ name, object: grp, onRemove: dropPart });
    it.kind = kind; it.size = kind ? primSize : null; it.scale = [...primScale]; it.sid = sid; mine.push(it); scene.add(grp);
    list.select(it);
    trackPart(it, "Add");
  }
  function dropPart(it) { // the list already removed the row. The shape is kept (in memory and in the worker) so Undo can bring it back
    const wasSelected = it === cur, i = mine.indexOf(it); if (i >= 0) mine.splice(i, 1);
    if (wasSelected) { attachAll(null); cur = null; part = null; partKind = null; }
    scene.remove(it.object);
    if (wasSelected && mine.length) list.select(mine[mine.length - 1]);
    syncGizmo(); refresh();
    if (!isReplaying()) trackPart(it, "Delete");
  }
  function bringBack(it) { mine.push(it); scene.add(it.object); list.readd(it); list.select(it); }
  function trackPart(it, verb) { // Add / Delete as one undo step; the part is freed for good only when its step falls off the history
    const add = () => bringBack(it), del = () => list.remove(it);
    record(`${verb} ${it.name}`, verb === "Add" ? del : add, verb === "Add" ? add : del, () => { if (!mine.includes(it)) { free(it.object); geo("drop", { sid: it.sid }); } });
  }
  function resetPose() {
    if (!part) return;
    const o = part, b = pose(o), z = { p: new THREE.Vector3(), r: new THREE.Euler() };
    setPose(o, z);
    if (!b.p.equals(z.p) || !b.r.equals(z.r)) record("Reset position", () => setPose(o, b), () => setPose(o, z));
  }
  function onPart(m) { // reply of "import" or "primitive"
    $("status").textContent = "Ready";
    if (!m.ok) return say("bad", "✖ " + m.error);
    m.mesh.fg = m.fg;
    const kind = m.kind ?? null;
    setPart(m.mesh, m.name ?? te.primitives.find((p) => p.id === kind)?.label ?? "Part", kind, m.sid);
    upOpen = true; paintUp(); // open Position and rotation so the new part's controls are seen at once
    say("ok", "✔ Loaded " + (m.name ?? "part"));
  }

  // ---------- number rows (slider + typed value; typing may go beyond the slider range) ----------
  function numRow(label, cfg, get, set, needPart = true, parent = body, helpId) { // typing may go beyond the slider range
    const rec = cfg.recommendedRange;
    const nr = numberRow({ label, cfg, help: helpId, get, set, live: refresh, off: () => needPart && !part, digits: 3,
      note: (rec ? `recommended ${rec[0]} to ${rec[1]}; ` : "") + "type any value to go beyond the slider",
      rate: (v) => (rec ? (v >= rec[0] && v <= rec[1] ? "ok" : "warn") : "") });
    parent.append(nr.el); refreshers.push(nr.refresh);
  }

  // ---------- Import STEP ----------
  const imp = blk("Import a STEP file");
  const file = Object.assign(document.createElement("input"), { type: "file", accept: ".step,.stp" });
  file.onchange = () => { const f = file.files[0]; if (f) say("", "Selected: " + f.name + ". Click Add STEP."); };
  async function addStep() {
    const f = file.files[0]; if (!f) return say("bad", "✖ Choose a STEP file first.");
    const mb = f.size / 1048576;
    if (mb > limit) return say("bad", `✖ File is ${mb.toFixed(1)} MB, above the ${limit} MB limit. Please use a simpler file.`);
    const buf = await f.arrayBuffer();
    if (!new TextDecoder().decode(buf.slice(0, 200)).includes("ISO-10303-21"))
      return say("bad", "✖ This does not look like a STEP file. Only STEP (B-rep) works for now, not IGES or mesh files (STL, OBJ).");
    say("", "Reading file…"); $("status").textContent = "Importing…";
    file.value = "";
    geo("import", { name: f.name, data: buf, sid: ++sidN }, onPart, [buf]);
  }
  file.style.cssText = "display:block;width:100%;margin-bottom:8px;box-sizing:border-box";
  imp.append(file, btn("Add STEP", addStep));

  // ---------- Primitive ----------
  function sendPrim() {
    if (!(primSize > 0)) return say("bad", "✖ Size must be above 0.");
    $("status").textContent = "Building…";
    geo("primitive", { kind: primKind, size: primSize, scale: primScale, sid: ++sidN, name: te.primitives.find((p) => p.id === primKind).label }, onPart);
  }
  function applyPrim() { // rebuild the selected primitive with the type, size and scale shown above; position and rotation stay
    const it = cur; if (!it?.kind) return say("bad", "✖ Select a primitive first.");
    if (!(primSize > 0) || !primScale.every((v) => v > 0)) return say("bad", "✖ Size and scale must be above 0.");
    const next = { kind: primKind, size: primSize, scale: [...primScale], sid: ++sidN }, old = { kind: it.kind, size: it.size, scale: [...it.scale], sid: it.sid };
    $("status").textContent = "Building…";
    geo("primitive", { ...next, name: it.name }, (m) => {
      $("status").textContent = "Ready";
      if (!m.ok) return say("bad", "✖ " + m.error);
      const fresh = meshFrom(m.mesh, mat.clone()); fresh.userData.base = true;
      const swap = (to, from) => { // show the shape "to"; "mesh" holds the mesh of that shape
        const grp = it.object, oldMesh = grp.children.find((c) => c.userData.base);
        const shown = to.mesh ?? fresh; if (oldMesh) { grp.remove(oldMesh); from.mesh = oldMesh; }
        grp.add(shown); grp.userData.fg = to.fg ?? m.fg;
        Object.assign(it, { kind: to.kind, size: to.size, scale: [...to.scale], sid: to.sid });
        if (cur === it) { primKind = it.kind; primSize = it.size; primScale = [...it.scale]; kindSel.value = primKind; }
        refresh();
      };
      const nw = { ...next, fg: m.fg, mesh: fresh }, od = { ...old, fg: it.object.userData.fg };
      swap(nw, od);
      record("Edit " + it.name, () => swap(od, nw), () => swap(nw, od));
      say("ok", "✔ Updated " + it.name);
    });
  }
  const kindSel = document.createElement("select");
  te.primitives.forEach((p) => kindSel.add(new Option(p.label, p.id)));
  kindSel.onchange = () => { primKind = kindSel.value; }; // only chooses what "Add primitive" will add
  const prim = blk("Add a primitive");
  kindSel.style.marginBottom = "4px"; prim.append(kindSel);
  numRow("Size (mm)", te.primitiveSize, () => primSize, (v) => { primSize = v; }, false, prim, "primitiveSize");
  ["X", "Y", "Z"].forEach((a, i) => numRow("Scale " + a, te.primitiveScale, () => primScale[i], (v) => { primScale[i] = v; }, false, prim, "primitiveScale"));
  prim.append(btn("Add primitive", sendPrim), btn("Apply to selected primitive", applyPrim));
  const sb = blk("Snap faces"); sb.append(snapBtn, help("snapFaces")); snapBtn.style.marginRight = "6px";
  blk("Selected part").append(btn("Remove selected part", () => cur && list.remove(cur)));
  body.append(msg);

  // ---------- Position and rotation: drop-up at the bottom-left of the 3D view (only in stage B, with an object selected) ----------
  dropUp = document.createElement("div"); dropUp.style.cssText = "position:absolute;bottom:8px;left:8px;z-index:5;display:none;flex-direction:column-reverse;align-items:flex-start";
  const upBtn = document.createElement("button"), upMenu = document.createElement("div"); let upOpen = false;
  upMenu.style.cssText = "display:none;margin-bottom:4px;width:290px;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:4px 8px;text-align:left";
  const paintUp = () => { upBtn.textContent = "Position and rotation " + (upOpen ? "▾" : "▴"); upMenu.style.display = upOpen ? "" : "none"; };
  upBtn.onclick = () => { upOpen = !upOpen; paintUp(); }; paintUp();
  document.addEventListener("click", (e) => { if (upOpen && !e.composedPath().includes(dropUp)) { upOpen = false; paintUp(); } });
  dropUp.append(upBtn, upMenu); view.append(dropUp);
  const spaceSeg = segmented([{ id: "world", label: "World" }, { id: "local", label: "Part" }], (s) => gizmos.forEach((g) => g.setSpace(s))); spaceSeg.set("world");
  const spaceRow = document.createElement("div"); spaceRow.style.cssText = "display:flex;align-items:center;gap:6px;margin:6px 0";
  const lab = document.createElement("span"); lab.textContent = "Arrows follow"; spaceRow.append(lab, spaceSeg.el, help("space")); spaceSeg.el.style.flex = "1";
  const grid = document.createElement("div"); grid.className = "pgrid";
  const cap = (t) => { const c = document.createElement("div"); c.className = "pcap"; c.textContent = t; return c; };
  const cell = (label, cfg, get, set, name) => { // one small number box (typed, or moved by the gizmo)
    const nr = numberRow({ label, name, cfg, compact: true, get, set, live: refresh, off: () => !part, digits: 2 });
    grid.append(nr.el); refreshers.push(nr.refresh);
  };
  grid.append(cap("Position (mm)"));
  for (const a of ["x", "y", "z"]) cell(a.toUpperCase(), te.position, () => part?.position[a] ?? 0, (v) => (part.position[a] = v), "Position " + a.toUpperCase());
  grid.append(cap("Rotation (°)"));
  for (const a of ["x", "y", "z"]) cell(a.toUpperCase(), te.rotation, () => ((part?.rotation[a] ?? 0) * 180) / Math.PI, (v) => (part.rotation[a] = (v * Math.PI) / 180), "Rotation " + a.toUpperCase());
  const foot = document.createElement("div"); foot.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:6px"; foot.append(btn("Reset position", resetPose), help("moveRotate"));
  foot.firstChild.style.margin = "0";
  upMenu.append(spaceRow, grid, foot);
  syncGizmo();
  refresh();
  // stage C still works with one part: the selected one, or the newest if the flange is selected
  return { getPart: () => part ?? mine[mine.length - 1]?.object ?? null };
}