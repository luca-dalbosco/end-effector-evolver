// Stage B: Tool End. Import STEP parts or add primitives (as many as you like), show them next to the tool start,
// move/rotate the one selected in the object list (or clicked in the 3D view) with a gizmo.
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import te from "../data/toolEnd.json";

export function initToolEnd({ scene, cam, renderer, orbit, worker, $, refreshers, list }) {
  const refresh = () => refreshers.forEach((f) => f());
  const limit = te.maxFileSizeMB.default; // internal limit: edit it in data/toolEnd.json, not shown in the UI
  let part = null, partKind = null, cur = null, stage = "A", primKind = te.primitives[0].id, primSize = te.primitiveSize.default;
  const mine = []; // list entries that are tool-end parts (the flange is not in here)
  const dom = renderer.domElement;

  // ---------- panel (shown only in stage B) ----------
  const stageA = ["top", "controls", "msg", "exportA"].map($);
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
  const head = (t) => { const b = document.createElement("div"); b.textContent = t; b.style.cssText = "font-weight:700;margin:14px 0 4px"; panel.append(b); };
  const btn = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; return b; };

  // ---------- gizmo: move arrows + rotate rings together (two controls on the same object) ----------
  const gT = new TransformControls(cam, dom), gR = new TransformControls(cam, dom), gizmos = [gT, gR], helpers = gizmos.map((g) => g.getHelper());
  gR.setMode("rotate"); gT.setSize(0.8); gR.setSize(1.2); // arrows inside, rings outside (tune these two numbers if you like)
  try { // no free-rotate ball and no outer ring: they would cover the arrows
    for (const grp of [gR._gizmo.gizmo.rotate, gR._gizmo.picker.rotate]) [...grp.children].filter((c) => c.name === "XYZE" || c.name === "E").forEach((c) => grp.remove(c));
  } catch (err) { /* harmless: the gizmo just keeps its extra handles */ }
  helpers.forEach((h) => { h.visible = false; scene.add(h); });
  gizmos.forEach((g) => { g.addEventListener("dragging-changed", (e) => (orbit.enabled = !e.value)); g.addEventListener("objectChange", refresh); });
  function syncGizmo() { const on = stage === "B"; gizmos.forEach((g) => (g.enabled = on)); helpers.forEach((h) => (h.visible = on && !!part)); }
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

  function setPart(m, keep, name, kind) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(m.v, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(m.n, 3)); bg.setIndex(new THREE.BufferAttribute(m.t, 1));
    const mesh = new THREE.Mesh(bg, mat.clone()); mesh.userData.base = true; // "base" = the mesh the list makes transparent
    const grp = new THREE.Group(); grp.userData.fg = m.fg; grp.add(mesh);
    if (keep && cur && cur.kind) { // "Apply to selected primitive": replace it, same place, same name (unless renamed)
      grp.position.copy(part.position); grp.rotation.copy(part.rotation);
      scene.remove(part); free(part);
      cur.object = grp; cur.kind = kind; cur.size = primSize; part = grp; partKind = kind;
      if (cur.auto) list.setName(cur, name);
      scene.add(grp); attachAll(grp); list.refreshVisibility(); syncGizmo(); refresh();
    } else { // a new object
      const it = list.add({ name, object: grp, onRemove: dropPart });
      it.kind = kind; it.size = kind ? primSize : null; mine.push(it); scene.add(grp);
      list.select(it);
    }
  }
  function dropPart(it) { // the list already removed the row
    const wasSelected = it === cur, i = mine.indexOf(it); if (i >= 0) mine.splice(i, 1);
    if (wasSelected) { attachAll(null); cur = null; part = null; partKind = null; }
    scene.remove(it.object); free(it.object);
    if (wasSelected && mine.length) list.select(mine[mine.length - 1]);
    syncGizmo(); refresh();
  }
  function resetPose() { if (!part) return; part.position.set(0, 0, 0); part.rotation.set(0, 0, 0); refresh(); }
  worker.addEventListener("message", (e) => {
    const m = e.data; if (!m.imported) return;
    $("status").textContent = "Ready";
    if (!m.ok) return say("bad", "✖ " + m.error);
    m.mesh.fg = m.fg;
    const kind = m.kind ?? null;
    setPart(m.mesh, m.keep, m.name ?? te.primitives.find((p) => p.id === kind)?.label ?? "Part", kind);
    say("ok", "✔ Loaded " + (m.name ?? "part"));
  });

  // ---------- number rows (slider + typed value; typing may go beyond the slider range) ----------
  function numRow(label, cfg, get, set, needPart = true) {
    const d = document.createElement("div"); d.className = "row";
    const l = document.createElement("label"), r = document.createElement("input"), n = document.createElement("input"), note = document.createElement("div");
    l.textContent = label; r.type = "range"; n.type = "number";
    r.min = cfg.min; r.max = cfg.max; r.step = cfg.step; n.step = cfg.step; // only the slider is limited
    const rec = cfg.recommendedRange; note.className = "rec";
    note.textContent = (rec ? `recommended ${rec[0]} to ${rec[1]}; ` : "") + "type any value to go beyond the slider";
    r.oninput = () => { if (needPart && !part) return; set(+r.value); refresh(); };
    n.onchange = () => { const v = +n.value; if (n.value === "" || isNaN(v) || (needPart && !part)) return; set(v); refresh(); };
    d.append(l, r, n, note); panel.append(d);
    refreshers.push(() => {
      const v = Math.round(get() * 1000) / 1000; r.value = n.value = v;
      d.classList.toggle("off", needPart && !part);
      n.className = rec ? (v >= rec[0] && v <= rec[1] ? "ok" : "warn") : "";
    });
  }

  // ---------- Import STEP ----------
  panel.append(msg);
  head("Import STEP");
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
    worker.postMessage({ type: "import", name: f.name, data: buf }, [buf]);
  }
  panel.append(file, btn("Add STEP", addStep));

  // ---------- Primitive ----------
  head("Primitive");
  function sendPrim(keep) {
    if (!(primSize > 0)) return say("bad", "✖ Size must be above 0.");
    $("status").textContent = "Building…";
    worker.postMessage({ type: "primitive", kind: primKind, size: primSize, keep, name: te.primitives.find((p) => p.id === primKind).label });
  }
  const kindSel = document.createElement("select");
  te.primitives.forEach((p) => kindSel.add(new Option(p.label, p.id)));
  kindSel.onchange = () => { primKind = kindSel.value; }; // only chooses what "Add primitive" will add
  panel.append(kindSel);
  numRow("Size (mm)", te.primitiveSize, () => primSize, (v) => { primSize = v; }, false);
  const hint = document.createElement("div"); hint.className = "rec";
  hint.textContent = "Cube: edge length. Cylinder and cone: diameter and height. Sphere and other solids: overall diameter. The type and size above are used by \"Add primitive\" (a new object) or \"Apply to selected primitive\" (changes the selected one).";
  const bApply = btn("Apply to selected primitive", () => partKind && sendPrim(true));
  refreshers.push(() => (bApply.disabled = !partKind));
  panel.append(hint, btn("Add primitive", () => sendPrim(false)), bApply);

  // ---------- Position and rotation (of the selected object) ----------
  head("Position and rotation");
  const pickHint = document.createElement("div"); pickHint.className = "rec";
  pickHint.textContent = "Click an object in the 3D view or in the Objects list (top right) to move or rotate it: arrows move, rings rotate."; panel.append(pickHint);
  const bSpace = btn("Space: world", () => { const s = gT.space === "world" ? "local" : "world"; gizmos.forEach((g) => g.setSpace(s)); bSpace.textContent = "Space: " + s; });
  panel.append(bSpace, btn("Reset position", resetPose), btn("Remove selected part", () => cur && list.remove(cur)));
  for (const a of ["x", "y", "z"]) numRow(`Position ${a.toUpperCase()} (mm)`, te.position, () => part?.position[a] ?? 0, (v) => (part.position[a] = v));
  for (const a of ["x", "y", "z"]) numRow(`Rotation ${a.toUpperCase()} (°)`, te.rotation, () => ((part?.rotation[a] ?? 0) * 180) / Math.PI, (v) => (part.rotation[a] = (v * Math.PI) / 180));
  refresh();
  // stage C still works with one part: the selected one, or the newest if the flange is selected
  return { getPart: () => part ?? mine[mine.length - 1]?.object ?? null };
}