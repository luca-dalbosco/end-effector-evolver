// Stage B: Tool End. Import a STEP part or add a primitive, show it next to the tool start, move/rotate it with a gizmo.
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import te from "../data/toolEnd.json";

export function initToolEnd({ scene, cam, renderer, orbit, worker, $, refreshers }) {
  const refresh = () => refreshers.forEach((f) => f());
  const limit = te.maxFileSizeMB.default; // internal limit: edit it in data/toolEnd.json, not shown in the UI
  let part = null, partKind = null, primKind = te.primitives[0].id, primSize = te.primitiveSize.default, timer = null;

  // ---------- panel (shown only in stage B) ----------
  const stageA = ["controls", "msg", "exportA"].map($);
  const panel = document.createElement("div"); panel.style.display = "none"; $("exportA").after(panel);
  const spans = document.querySelectorAll("#steps span[data-s]");
  spans.forEach((s) => (s.onclick = () => showStage(s.dataset.s)));
  function showStage(st) {
    const b = st === "B";
    stageA.forEach((el) => (el.style.display = b ? "none" : ""));
    panel.style.display = b ? "" : "none";
    gizmo.enabled = b; helper.visible = b && !!part;
    spans.forEach((s) => s.classList.toggle("on", s.dataset.s === st));
  }
  const head = (t) => { const b = document.createElement("div"); b.textContent = t; b.style.cssText = "font-weight:700;margin:14px 0 4px"; panel.append(b); };
  const btn = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; return b; };
  const mark = (b, on) => { b.style.background = on ? "var(--fg)" : ""; b.style.color = on ? "var(--bg)" : ""; };

  // ---------- gizmo ----------
  const gizmo = new TransformControls(cam, renderer.domElement), helper = gizmo.getHelper();
  helper.visible = false; gizmo.setSize(1); scene.add(helper);
  gizmo.addEventListener("dragging-changed", (e) => (orbit.enabled = !e.value));
  gizmo.addEventListener("objectChange", refresh);

  // ---------- part in the scene ----------
  const msg = document.createElement("div"); msg.style.cssText = "font-size:12px;margin:6px 0";
  const say = (cls, text) => { msg.innerHTML = ""; const d = document.createElement("div"); d.className = cls; d.textContent = text; msg.append(d); };
  const mat = new THREE.MeshStandardMaterial({ color: 0xd98c3f, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
  function setPart(m, keep) {
    const pos = keep && part ? part.position.clone() : null, rot = keep && part ? part.rotation.clone() : null;
    removePart();
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(m.v, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(m.n, 3)); bg.setIndex(new THREE.BufferAttribute(m.t, 1));
    part = new THREE.Group(); part.add(new THREE.Mesh(bg, mat));
    if (pos) { part.position.copy(pos); part.rotation.copy(rot); }
    scene.add(part); gizmo.attach(part); helper.visible = true; refresh();
  }
  function removePart() {
    if (!part) return;
    gizmo.detach(); scene.remove(part); part.children[0].geometry.dispose(); part = null; partKind = null; helper.visible = false; refresh();
  }
  function resetPose() { if (!part) return; part.position.set(0, 0, 0); part.rotation.set(0, 0, 0); refresh(); }
  worker.addEventListener("message", (e) => {
    const m = e.data; if (!m.imported) return;
    $("status").textContent = "Ready";
    if (!m.ok) return say("bad", "✖ " + m.error);
    setPart(m.mesh, m.keep); partKind = m.kind ?? null; say("ok", "✔ Loaded " + m.name);
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
  const sel = document.createElement("select");
  te.primitives.forEach((p) => sel.add(new Option(p.label, p.id)));
  sel.onchange = () => { primKind = sel.value; if (partKind) sendPrim(true); };
  panel.append(sel);
  numRow("Size (mm)", te.primitiveSize, () => primSize, (v) => { primSize = v; if (partKind) { clearTimeout(timer); timer = setTimeout(() => sendPrim(true), 250); } }, false);
  const hint = document.createElement("div"); hint.className = "rec";
  hint.textContent = "Cube: edge length. Cylinder and cone: diameter and height. Sphere and other solids: overall diameter.";
  panel.append(hint, btn("Add primitive", () => sendPrim(false)));

  // ---------- Position and rotation ----------
  head("Position and rotation");
  const bMove = btn("Move", () => { gizmo.setMode("translate"); mark(bMove, true); mark(bRot, false); });
  const bRot = btn("Rotate", () => { gizmo.setMode("rotate"); mark(bMove, false); mark(bRot, true); });
  const bSpace = btn("Space: world", () => { gizmo.setSpace(gizmo.space === "world" ? "local" : "world"); bSpace.textContent = "Space: " + gizmo.space; });
  mark(bMove, true);
  panel.append(bMove, bRot, bSpace, btn("Reset position", resetPose), btn("Remove part", removePart));
  for (const a of ["x", "y", "z"]) numRow(`Position ${a.toUpperCase()} (mm)`, te.position, () => part?.position[a] ?? 0, (v) => (part.position[a] = v));
  for (const a of ["x", "y", "z"]) numRow(`Rotation ${a.toUpperCase()} (°)`, te.rotation, () => ((part?.rotation[a] ?? 0) * 180) / Math.PI, (v) => (part.rotation[a] = (v * Math.PI) / 180));
  refresh();
}