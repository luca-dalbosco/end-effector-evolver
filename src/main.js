import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import flangeData from "../data/flanges.json";
import ts from "../data/toolStart.json";
import { initFooterLinks } from './footerLinks.js';
import { initToolEnd } from './toolEnd.js';
import { initToolConnect } from './toolConnect/index.js';
import { initObjectList } from './objectList.js';
import { initExport } from './exportStage.js';
import exportCfg from "../data/export.json";
import { initAdvanced, initSteps, section, help, line, download, numberRow, recNote } from './ui.js';
import { rpc, serial } from './rpc.js';
import { record } from './history.js';

const geo = rpc(new Worker(new URL("./worker.js", import.meta.url), { type: "module" })); // geometry engine (OpenCascade)
const $ = (id) => document.getElementById(id);
// saved custom flanges: a broken or old entry is skipped instead of stopping the app
const savedFlanges = () => { try { const a = JSON.parse(localStorage.getItem("customFlanges") || "[]"); return Array.isArray(a) ? a.filter((f) => f?.id && f.geometry?.pitchCircleDiameter > 0 && f.geometry.threadedHoles) : []; } catch (e) { return []; } };
const flanges = [...flangeData.flanges, ...savedFlanges()];
const ready = (f) => f.status !== "needs data";
const cur = { flange: flanges.find(ready) };
const tolCfg = ts.tolerances;
const settings = { fitMode: ts.fitMode.default, thickness: ts.thickness.default, dowelMode: ts.dowel.mode.default, headSeat: ts.screwClearance.headSeat.default,
  plateMargin: ts.plateEdgeMargin.default, spigotStyle: ts.spigotStyle.default, wallKeys: ts.wallKeys.default, chamfer: { robotFacing: false, awayFacing: false, size: ts.chamfer.size.default },
  tolerances: Object.fromEntries(Object.entries(tolCfg).filter(([, v]) => typeof v === "object").map(([k, v]) => [k, v.default])) };
let advanced = false, timer = null, startInfo = null, startOk = false;
const refreshers = [];
const g = () => cur.flange.geometry;

// ---------- controls ----------
let host = $("controls"); // rows go into the current section body
const sec = (title, helpId, parent = $("controls")) => { const s = section(title, helpId); parent.append(s.box); host = s.body; };
function row(label, el, used = () => true, hidden = () => false, helpId) {
  const d = document.createElement("div"); d.className = "row"; d.innerHTML = `<label>${label}</label>`; if (helpId) d.firstChild.append(help(helpId)); d.append(el); host.append(d);
  refreshers.push(() => { d.classList.toggle("off", !used()); d.style.display = hidden() ? "none" : ""; });
}
function select(label, getOpts, get, set, used, optOk = () => true, helpId) {
  const s = document.createElement("select");
  const fill = () => { const v = get(); s.innerHTML = ""; getOpts().forEach((o) => { const op = new Option(o.label ?? o, o.id ?? o); op.disabled = !optOk(o); s.add(op); }); s.value = v; };
  s.onchange = () => { const b = snap(), v = s.value, t = s.selectedOptions[0]?.text ?? v; set(v); refreshAll(); schedule(); if (v !== "__add") undoable(label, t, b); };
  row(label, s, used, undefined, helpId); refreshers.push(fill); return fill;
}
function check(label, get, set, hidden, helpId) { const l = document.createElement("label"), c = document.createElement("input"); c.type = "checkbox"; c.onchange = () => { const b = snap(); set(c.checked); refreshAll(); schedule(); undoable(plain(label), c.checked ? "on" : "off", b); }; l.append(c, " " + label); if (helpId) l.append(help(helpId)); row("", l, () => true, hidden); refreshers.push(() => (c.checked = get())); }
function slider(label, cfg, get, set, used = () => true, hidden = () => false, helpId) {
  const nr = numberRow({ label, cfg, help: helpId, get, set, live: refreshAll, commit: schedule, clamp: () => !advanced, note: recNote(cfg), hidden, off: () => !used(), lockSlider: () => advanced });
  host.append(nr.el); refreshers.push(nr.refresh);
}
const refreshAll = () => refreshers.forEach((f) => f());
// undo of the robot-side menus and ticks: the whole flange choice and settings are kept before and after the change
const snap = () => ({ flange: cur.flange, settings: structuredClone(settings) });
const restore = (sn) => { cur.flange = sn.flange; Object.assign(settings, structuredClone(sn.settings)); refreshAll(); schedule(); };
function undoable(label, text, before) { const a = snap(); record(`${label}: ${text}`, () => restore(before), () => restore(a)); }
const plain = (l) => l.replace(/\s*\(.*\)$/, "");

// robot menus: brand, then model
const ADD = { id: "__add", label: "+ Add custom flange…" };
const brands = () => [...new Set(flanges.map((f) => f.brand)), ADD];
const models = () => flanges.filter((f) => f.brand === cur.flange.brand);
sec("Robot");
select("Brand", brands, () => cur.flange.brand, (v) => { if (v === ADD.id) return openForm(); cur.flange = flanges.find((f) => f.brand === v && ready(f)) ?? flanges.find((f) => f.brand === v); fixSettings(); }, undefined, (b) => b.id === ADD.id || flanges.some((f) => f.brand === b && ready(f)));
select("Robot model", () => [...models().map((f) => ({ id: f.id, label: f.model + (ready(f) ? "" : " (data needed)") })), ADD], () => cur.flange.id,
  (v) => { if (v === ADD.id) return openForm(); cur.flange = flanges.find((f) => f.id === v); fixSettings(); }, undefined, (o) => o.id === ADD.id || ready(flanges.find((f) => f.id === o.id)));
function fixSettings() { if (settings.fitMode === "plate-spigot" && !g()?.centreHole) settings.fitMode = "plate"; if (settings.fitMode === "plate-spigot-collar" && !(g()?.centreHole && g()?.raisedSpigot)) settings.fitMode = "plate"; if (settings.fitMode === "plate") settings.dowelMode = "hole"; }
const fitOk = (o) => o.id === "plate" || (!!g()?.centreHole && (o.id === "plate-spigot" || !!g()?.raisedSpigot));
sec("Fit");
select("Fit mode", () => ts.fitMode.options, () => settings.fitMode, (v) => { settings.fitMode = v; fixSettings(); }, undefined, fitOk, "fitMode");
select("Spigot", () => ts.spigotStyle.options, () => settings.spigotStyle, (v) => (settings.spigotStyle = v), () => settings.fitMode !== "plate", undefined, "spigot");
const hasPockets = () => settings.fitMode !== "plate" && !!(g()?.centreHole?.wallPockets || (settings.fitMode === "plate-spigot-collar" && g()?.raisedSpigot?.wallPockets));
check("Wall keys (fit the flange pockets)", () => settings.wallKeys, (v) => (settings.wallKeys = v), () => !hasPockets(), "wallKeys");
slider("Thickness (mm)", ts.thickness, () => settings.thickness, (v) => (settings.thickness = v), undefined, undefined, "thickness");
slider("Plate edge margin (mm)", ts.plateEdgeMargin, () => settings.plateMargin, (v) => (settings.plateMargin = v), undefined, undefined, "plateMargin");
select("Dowel", () => ts.dowel.mode.options, () => settings.dowelMode, (v) => (settings.dowelMode = v), () => !!g()?.locatingPin, (o) => !(o.id === "printedPin" && settings.fitMode === "plate"), "dowel");
select("Screw head seat", () => ts.screwClearance.headSeat.options, () => settings.headSeat, (v) => (settings.headSeat = v), undefined, undefined, "headSeat");
sec("Tolerances", "tolerances");
const T = (k, label, used) => slider(label, tolCfg[k], () => settings.tolerances[k], (v) => (settings.tolerances[k] = v), used);
T("screwHole", "Screw hole tolerance (mm)");
T("spigot", "Spigot tolerance (mm)", () => settings.fitMode !== "plate");
T("collar", "Collar tolerance (mm)", () => settings.fitMode === "plate-spigot-collar");
T("dowelHole", "Dowel hole tolerance (mm)", () => settings.dowelMode === "hole" && !!g()?.locatingPin);
T("dowelPin", "Printed dowel tolerance (mm)", () => settings.dowelMode === "printedPin");
sec("Finish & export", undefined, $("exportA"));
check("Chamfer, faces toward the robot", () => settings.chamfer.robotFacing, (v) => (settings.chamfer.robotFacing = v));
check("Chamfer, faces away from the robot", () => settings.chamfer.awayFacing, (v) => (settings.chamfer.awayFacing = v));
slider("Chamfer size (mm)", ts.chamfer.size, () => settings.chamfer.size, (v) => (settings.chamfer.size = v), () => true, () => !advanced);
const ex = document.createElement("div"); ex.className = "row"; ex.innerHTML = '<label>Export robot side</label><button data-f="step">STEP</button><button data-f="stl">STL</button><button data-f="3mf">3MF</button>'; host.append(ex);
initAdvanced($("adv"));
document.addEventListener("advanced", (e) => { if (e.detail.stage !== "A") return; advanced = e.detail.on; if (!advanced) settings.chamfer.size = ts.chamfer.size.default; refreshAll(); schedule(); });

// ---------- local flange form ----------
const fields = [["brand", "Brand (optional, e.g. KUKA)", "text"], ["name", "Model name (e.g. My robot)", "text"], ["pcd", "Pitch circle diameter", "number"], ["thread", "Screw thread", Object.keys(ts.screwClearance.headDiameterByScrew).join(",")], ["threadDepth", "Thread depth", "number"],
  ["positions", "Number of hole positions on the circle", "number"], ["pinD", "Locating pin hole diameter (empty = no pin; it takes position 0)", "number?"], ["pinDepth", "Pin hole depth", "number?"],
  ["spigotD", "Raised spigot diameter (empty = none)", "number?"], ["spigotH", "Raised spigot height", "number?"], ["centreD", "Centre hole diameter (empty = none)", "number?"], ["centreDepth", "Centre hole depth", "number?"],
  ["outerD", "Flange outer diameter (needed when there is no raised spigot)", "number?"]];
const dlg = document.createElement("dialog"); dlg.innerHTML = "<b>Create local robotic flange</b><div id='ff'></div><div id='fe' class='bad'></div><button id='fs'>Save</button><button id='fc'>Cancel</button>"; document.body.append(dlg);
$("ff").innerHTML = fields.map(([k, l, t]) => `<label>${l}${t.includes(",") ? `<select id="f_${k}">${t.split(",").map((o) => `<option>${o}</option>`).join("")}</select>` : `<input id="f_${k}" type="${t.startsWith("number") ? "number" : "text"}" step="any">`}</label>`).join("");
$("f_thread").value = "M5"; // the common robot flange screw
const fv = (k) => $("f_" + k).value, fn = (k) => (fv(k) === "" ? null : +fv(k));
function openForm() { $("fe").textContent = ""; dlg.showModal(); }
$("fc").onclick = () => { dlg.close(); refreshAll(); };
$("fs").onclick = () => {
  const pos = fn("positions"), pin = fn("pinD") != null, need = ["pcd", "threadDepth", "positions"].filter((k) => !(fn(k) > 0));
  if (!fv("name") || need.length || (!fn("spigotD") && !fn("outerD")) || (pin && !(fn("pinDepth") > 0)) || (fn("spigotD") && !(fn("spigotH") > 0)) || (fn("centreD") && !(fn("centreDepth") > 0)))
    return ($("fe").textContent = "Please fill name, pitch circle, thread depth, positions, the depths of the features you use, and either a spigot or an outer diameter.");
  const step = 360 / pos, count = pos - (pin ? 1 : 0);
  const geometry = { pitchCircleDiameter: fn("pcd"), threadedHoles: { count, thread: fv("thread"), threadDepth: fn("threadDepth"), startAngleDeg: pin ? step : 0, spacingDeg: step } };
  if (pin) geometry.locatingPin = { diameter: fn("pinD"), depth: fn("pinDepth"), angleDeg: 0 };
  if (fn("spigotD")) geometry.raisedSpigot = { diameter: fn("spigotD"), height: fn("spigotH") };
  if (fn("centreD")) geometry.centreHole = { diameter: fn("centreD"), depth: fn("centreDepth") };
  if (fn("outerD")) geometry.outerDiameter = fn("outerD");
  const f = { id: "custom-" + Date.now(), brand: fv("brand").trim() ? fv("brand").trim() + " (Custom)" : "Custom", custom: true, model: fv("name"), geometry }; flanges.push(f);
  localStorage.setItem("customFlanges", JSON.stringify(flanges.filter((x) => x.custom || x.brand === "Custom"))); cur.flange = f; fixSettings(); dlg.close(); refreshAll(); schedule();
};

// ---------- viewer ----------
const view = $("view"), renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio); view.append(renderer.domElement);
const scene = new THREE.Scene();
const tb = Object.assign(document.createElement("button"), { title: "Light / dark" });
const setTheme = (light) => { document.body.classList.toggle("light", light); scene.background = new THREE.Color(light ? 0xf4f4f4 : 0x1e1f22); tb.textContent = light ? "☾" : "☀"; localStorage.setItem("theme", light ? "light" : "dark"); };
tb.onclick = () => setTheme(!document.body.classList.contains("light"));
Object.assign(tb.style, { position: "absolute", top: "40px", left: "8px", width: "32px", fontSize: "16px" }); view.append(tb); setTheme(localStorage.getItem("theme") === "light");
const cam = new THREE.PerspectiveCamera(40, 1, 1, 2000); cam.up.set(0, 0, 1); cam.position.set(90, -90, 70);
const orbit = new OrbitControls(cam, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.2)); const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(50, -80, 120); scene.add(dl);
const grid = new THREE.GridHelper(200, 20, 0x999999, 0xcccccc); grid.rotation.x = Math.PI / 2; scene.add(grid); scene.add(new THREE.AxesHelper(30));
const list = initObjectList({ view });
const startGroup = new THREE.Group(); scene.add(startGroup); // the tool start lives in this group so the list can hide it
list.add({ name: "Robotic flange", object: startGroup, deletable: false });
let mesh = null;
const resize = () => { renderer.setSize(view.clientWidth, view.clientHeight); cam.aspect = view.clientWidth / view.clientHeight; cam.updateProjectionMatrix(); };
addEventListener("resize", resize); resize();
// draw on demand: while something happens (input, orbit, worker replies, stage events) and for a moment after, not 60 times a second when idle
let drawUntil = 0, drawing = false;
const wake = () => { drawUntil = performance.now() + 1500; if (!drawing) { drawing = true; requestAnimationFrame(frame); } };
function frame() { renderer.render(scene, cam); if (performance.now() < drawUntil) requestAnimationFrame(frame); else drawing = false; }
for (const t of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "input", "change", "click", "resize"]) addEventListener(t, wake, { capture: true, passive: true });
for (const t of ["stage", "advanced", "startbuilt", "workerreply"]) document.addEventListener(t, wake);
orbit.addEventListener("change", wake); wake();
function show(m) {
  if (mesh) { startGroup.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(m.v, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(m.n, 3)); bg.setIndex(new THREE.BufferAttribute(m.t, 1));
  mesh = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0x4a7fb5, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide })); mesh.userData.base = true;
  startGroup.add(mesh); list.refreshVisibility(); // keeps Transparent / Not visible after each rebuild
}

// ---------- build / export ----------
function schedule() { clearTimeout(timer); timer = setTimeout(build, ts.rebuildDelayMs); }
const sendBuild = serial(geo, "build"); // one build at a time, only the newest settings wait
function build() {
  $("status").textContent = "Building…"; startOk = false;
  sendBuild({ flange: structuredClone(cur.flange), settings: structuredClone(settings) }, (m) => {
    $("status").textContent = m.ok ? "Ready" : "Cannot build"; startOk = !!m.ok;
    $("msg").replaceChildren(...(m.errors || []).map((x) => line("bad", "✖ " + x)), ...(m.warnings || []).map((x) => line("warn", "⚠ " + x)));
    if (m.ok) { show(m.mesh); startInfo = m; document.dispatchEvent(new Event("startbuilt")); }
  });
}
document.querySelectorAll("button[data-f]").forEach((b) => (b.onclick = () => { // same writer as stage 4, at its default resolution
  const q = exportCfg.resolution.options.find((o) => o.id === exportCfg.resolution.default);
  geo("exportScene", { format: b.dataset.f, tol: q.toleranceMm, ang: (q.angleDeg * Math.PI) / 180, items: [{ name: "Robot side", src: "start" }], base: `robot_side_${cur.flange.id}` },
    (m) => (m.ok ? download(m.file, m.data) : $("msg").replaceChildren(line("bad", "✖ " + m.error))));
}));
refreshAll(); build();

initFooterLinks(); 
const toolEnd = initToolEnd({ scene, cam, renderer, orbit, geo, $, refreshers, list, view });
const toolConnect = initToolConnect({ scene, cam, renderer, $, toolEnd, getStart: () => startInfo, list });
initExport({ geo, $, list, toolEnd, toolConnect, getStart: () => startInfo, getFlangeId: () => cur.flange.id });
initSteps({
  A: () => (startOk ? null : $("status").textContent === "Building…" ? "Building the robot side…" : "The robot side cannot be built. See the message above."),
  B: () => (toolEnd.getPart() ? null : "No object yet. Import a STEP file or add a primitive."),
  C: () => (toolConnect.connectedCount() ? null : "No face connected yet. Pick Connect face and click a face of the tool."),
  G: () => (toolConnect.getResult() ? null : "No connector yet. Connect a face in step 3 first."),
});