// Stage B: Tool End. Import STEP parts or add primitives (as many as you like), show them next to the tool start,
// move/rotate the one selected in the object list (or clicked in the 3D view) with a gizmo.
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import te from "../data/toolEnd.json";
import { section, help, numberRow } from "./ui.js";

export function initToolEnd({ scene, cam, renderer, orbit, geo, $, refreshers, list, view }) {
  const refresh = () => refreshers.forEach((f) => f());
  const limit = te.maxFileSizeMB.default; // internal limit: edit it in data/toolEnd.json, not shown in the UI
  let part = null, partKind = null, cur = null, stage = "A", primKind = te.primitives[0].id, primSize = te.primitiveSize.default;
  const mine = []; // list entries that are tool-end parts (the flange is not in here)
  let sidN = 0; // each part gets an id; the worker keeps its B-rep under it
  const dom = renderer.domElement;
  let dropUp = null; // position/rotation drop-up in the 3D view

  // ---------- panel (shown only in stage B) ----------
  const stageA = ["controls", "msg", "exportA"].map($);
  const panel = document.createElement("div"); panel.style.display = "none"; $("exportA").after(panel);
  const spans = document.querySelectorAll("#steps span[data-s]");
  spans.forEach((s) => (s.onclick = () => showStage(s.dataset.s)));
  function showStage(st) {
    stage = st;
    stageA.forEach((el) => (el.style.display = st === "A" ? "" : "none"));
    panel.style.display = st === "B" ? "" : "none";
    syncGizmo();
    spans.forEach((s) => s.classList.toggle("on", s.dataset.s === st));
    document.dispatchEvent(new CustomEvent("stage", { detail: st }));
  }
  const add = section("Add objects"); panel.append(add.box); const body = add.body;
  const btn = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; return b; };

  // ---------- gizmo: move arrows + rotate rings together (two controls on the same object) ----------
  const gT = new TransformControls(cam, dom), gR = new TransformControls(cam, dom), gizmos = [gT, gR], helpers = gizmos.map((g) => g.getHelper());
  gR.setMode("rotate"); gT.setSize(0.8); gR.setSize(1.2); // arrows inside, rings outside (tune these two numbers if you like)
  try { // no free-rotate ball and no outer ring: they would cover the arrows
    for (const grp of [gR._gizmo.gizmo.rotate, gR._gizmo.picker.rotate]) [...grp.children].filter((c) => c.name === "XYZE" || c.name === "E").forEach((c) => grp.remove(c));
  } catch (err) { /* harmless: the gizmo just keeps its extra handles */ }
  helpers.forEach((h) => { h.visible = false; scene.add(h); });
  gizmos.forEach((g) => { g.addEventListener("dragging-changed", (e) => (orbit.enabled = !e.value)); g.addEventListener("objectChange", refresh); });
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
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener("pointerup", (e) => {
    if (stage !== "B" || e.button !== 0 || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || gT.axis || gR.axis) return;
    const targets = list.items().filter((i) => i.object.visible);
    const meshes = targets.map((i) => i.object.children.find((c) => c.userData.base)).filter(Boolean);
    const r = dom.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(meshes, false)[0]; if (!hit) return;
    const it = targets.find((i) => i.object.children.includes(hit.object)); if (it) list.select(it);
  });

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
    if (cur?.kind) { primKind = cur.kind; primSize = cur.size; kindSel.value = primKind; } // dropdown and size show the selected primitive
    syncGizmo(); refresh();
  }
  list.onSelect(choose);

  function setPart(m, name, kind, sid) { // sid = id of the B-rep kept in the worker (Export uses it)
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(m.v, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(m.n, 3)); bg.setIndex(new THREE.BufferAttribute(m.t, 1));
    const mesh = new THREE.Mesh(bg, mat.clone()); mesh.userData.base = true; // "base" = the mesh the list makes transparent
    const grp = new THREE.Group(); grp.userData.fg = m.fg; grp.add(mesh);
    const it = list.add({ name, object: grp, onRemove: dropPart });
    it.kind = kind; it.size = kind ? primSize : null; it.sid = sid; mine.push(it); scene.add(grp);
    list.select(it);
  }
  function dropPart(it) { // the list already removed the row
    const wasSelected = it === cur, i = mine.indexOf(it); if (i >= 0) mine.splice(i, 1);
    if (wasSelected) { attachAll(null); cur = null; part = null; partKind = null; }
    scene.remove(it.object); free(it.object); geo("drop", { sid: it.sid });
    if (wasSelected && mine.length) list.select(mine[mine.length - 1]);
    syncGizmo(); refresh();
  }
  function resetPose() { if (!part) return; part.position.set(0, 0, 0); part.rotation.set(0, 0, 0); refresh(); }
  function onPart(m) { // reply of "import" or "primitive"
    $("status").textContent = "Ready";
    if (!m.ok) return say("bad", "✖ " + m.error);
    m.mesh.fg = m.fg;
    const kind = m.kind ?? null;
    setPart(m.mesh, m.name ?? te.primitives.find((p) => p.id === kind)?.label ?? "Part", kind, m.sid);
    say("ok", "✔ Loaded " + (m.name ?? "part"));
  }

  // ---------- number rows (slider + typed value; typing may go beyond the slider range) ----------
  function numRow(label, cfg, get, set, needPart = true, parent = body, helpId) { // typing may go beyond the slider range
    const rec = cfg.recommendedRange;
    const nr = numberRow({ label, cfg, help: helpId, get, set, live: refresh, off: () => needPart && !part, digits: 3,
      note: parent === body ? (rec ? `recommended ${rec[0]} to ${rec[1]}; ` : "") + "type any value to go beyond the slider" : null,
      rate: (v) => (rec ? (v >= rec[0] && v <= rec[1] ? "ok" : "warn") : "") });
    parent.append(nr.el); refreshers.push(nr.refresh);
  }

  // ---------- Import STEP ----------
  body.append(msg);
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
  body.append(file, btn("Add STEP", addStep));

  // ---------- Primitive ----------
  function sendPrim() {
    if (!(primSize > 0)) return say("bad", "✖ Size must be above 0.");
    $("status").textContent = "Building…";
    geo("primitive", { kind: primKind, size: primSize, sid: ++sidN, name: te.primitives.find((p) => p.id === primKind).label }, onPart);
  }
  const kindSel = document.createElement("select");
  te.primitives.forEach((p) => kindSel.add(new Option(p.label, p.id)));
  kindSel.onchange = () => { primKind = kindSel.value; }; // only chooses what "Add primitive" will add
  body.append(kindSel);
  numRow("Size (mm)", te.primitiveSize, () => primSize, (v) => { primSize = v; }, false, body, "primitiveSize");
  body.append(btn("Add primitive", sendPrim), btn("Remove selected part", () => cur && list.remove(cur)));

  // ---------- Position and rotation: drop-up at the bottom-left of the 3D view (only in stage B, with an object selected) ----------
  dropUp = document.createElement("div"); dropUp.style.cssText = "position:absolute;bottom:8px;left:8px;z-index:5;display:none;flex-direction:column-reverse;align-items:flex-start";
  const upBtn = document.createElement("button"), upMenu = document.createElement("div"); let upOpen = false;
  upMenu.style.cssText = "display:none;margin-bottom:4px;width:300px;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:4px 8px;text-align:left";
  const paintUp = () => { upBtn.textContent = "Position and rotation " + (upOpen ? "▾" : "▴"); upMenu.style.display = upOpen ? "" : "none"; };
  upBtn.onclick = () => { upOpen = !upOpen; paintUp(); }; paintUp();
  document.addEventListener("click", (e) => { if (upOpen && !e.composedPath().includes(dropUp)) { upOpen = false; paintUp(); } });
  dropUp.append(upBtn, upMenu); view.append(dropUp);
  const bSpace = btn("Space: world", () => { const s = gT.space === "world" ? "local" : "world"; gizmos.forEach((g) => g.setSpace(s)); bSpace.textContent = "Space: " + s; });
  const tools = document.createElement("div"); tools.append(bSpace, btn("Reset position", resetPose), help("moveRotate")); upMenu.append(tools);
  for (const a of ["x", "y", "z"]) numRow(`Position ${a.toUpperCase()} (mm)`, te.position, () => part?.position[a] ?? 0, (v) => (part.position[a] = v), true, upMenu);
  for (const a of ["x", "y", "z"]) numRow(`Rotation ${a.toUpperCase()} (°)`, te.rotation, () => ((part?.rotation[a] ?? 0) * 180) / Math.PI, (v) => (part.rotation[a] = (v * Math.PI) / 180), true, upMenu);
  syncGizmo();
  refresh();
  // stage C still works with one part: the selected one, or the newest if the flange is selected
  return { getPart: () => part ?? mine[mine.length - 1]?.object ?? null };
}