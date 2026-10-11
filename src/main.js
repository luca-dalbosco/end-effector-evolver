import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import flangeData from "../data/flanges.json";
import ts from "../data/toolStart.json";
import { initFooterLinks } from './footerLinks.js';

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const $ = (id) => document.getElementById(id);
const flanges = [...flangeData.flanges, ...JSON.parse(localStorage.getItem("customFlanges") || "[]")];
const ready = (f) => f.status !== "needs data";
const cur = { flange: flanges.find(ready) };
const tolCfg = ts.tolerances;
const settings = { fitMode: ts.fitMode.default, thickness: ts.thickness.default, dowelMode: ts.dowel.mode.default, headSeat: ts.screwClearance.headSeat.default,
  plateMargin: ts.plateEdgeMargin.default, spigotStyle: ts.spigotStyle.default, wallKeys: ts.wallKeys.default, chamfer: { robotFacing: false, awayFacing: false, size: ts.chamfer.size.default },
  tolerances: Object.fromEntries(Object.entries(tolCfg).filter(([, v]) => typeof v === "object").map(([k, v]) => [k, v.default])) };
let advanced = false, reqId = 0, timer = null;
const refreshers = [];
const g = () => cur.flange.geometry;

// ---------- controls ----------
function row(label, el, used = () => true, hidden = () => false) {
  const d = document.createElement("div"); d.className = "row"; d.innerHTML = `<label>${label}</label>`; d.append(el); $("controls").append(d);
  refreshers.push(() => { d.classList.toggle("off", !used()); d.style.display = hidden() ? "none" : ""; });
}
function select(label, getOpts, get, set, used, optOk = () => true) {
  const s = document.createElement("select");
  const fill = () => { const v = get(); s.innerHTML = ""; getOpts().forEach((o) => { const op = new Option(o.label ?? o, o.id ?? o); op.disabled = !optOk(o); s.add(op); }); s.value = v; };
  s.onchange = () => { set(s.value); refreshAll(); schedule(); };
  row(label, s, used); refreshers.push(fill); return fill;
}
function check(label, get, set, hidden) { const l = document.createElement("label"), c = document.createElement("input"); c.type = "checkbox"; c.onchange = () => { set(c.checked); refreshAll(); schedule(); }; l.append(c, " " + label); row("", l, () => true, hidden); refreshers.push(() => (c.checked = get())); }
function slider(label, cfg, get, set, used = () => true, hidden = () => false) {
  const r = document.createElement("input"), n = document.createElement("input"), box = document.createElement("div"), note = document.createElement("div");
  r.type = "range"; n.type = "number"; [r, n].forEach((x) => { x.min = cfg.min; x.max = cfg.max; x.step = cfg.step; });
  const rec = cfg.recommendedRange, bad = cfg.notRecommendedRange; note.className = "rec";
  note.textContent = (rec ? `recommended ${rec[0]} to ${rec[1]}` : "") + (bad ? `, not recommended ${bad[0]} to ${bad[1]}` : "");
  box.append(r, n, note);
  r.oninput = () => { set(+r.value); refreshAll(); }; r.onchange = schedule;
  n.onchange = () => { let v = +n.value; if (isNaN(v)) return; if (!advanced) v = Math.min(cfg.max, Math.max(cfg.min, v)); set(v); refreshAll(); schedule(); };
  row(label, box, used, hidden);
  refreshers.push(() => { const v = get(); r.value = n.value = v; r.disabled = advanced;
    n.className = rec && v >= rec[0] && v <= rec[1] ? "ok" : (bad && v >= bad[0] && v <= bad[1]) || v < cfg.min || v > cfg.max ? "bad" : "warn"; });
}
const refreshAll = () => refreshers.forEach((f) => f());

// robot menus: brand, then model
const brands = () => [...new Set(flanges.map((f) => f.brand))];
const models = () => flanges.filter((f) => f.brand === cur.flange.brand);
select("Brand", brands, () => cur.flange.brand, (v) => { cur.flange = flanges.find((f) => f.brand === v && ready(f)) ?? flanges.find((f) => f.brand === v); fixSettings(); }, undefined, (b) => flanges.some((f) => f.brand === b && ready(f)));
select("Robot model", () => models().map((f) => ({ id: f.id, label: f.model + (ready(f) ? "" : " (data needed)") })), () => cur.flange.id,
  (v) => { cur.flange = flanges.find((f) => f.id === v); fixSettings(); }, undefined, (o) => ready(flanges.find((f) => f.id === o.id)));
function fixSettings() { if (settings.fitMode === "plate-spigot" && !g()?.centreHole) settings.fitMode = "plate"; if (settings.fitMode === "plate-spigot-collar" && !(g()?.centreHole && g()?.raisedSpigot)) settings.fitMode = "plate"; if (settings.fitMode === "plate") settings.dowelMode = "hole"; }
const fitOk = (o) => o.id === "plate" || (!!g()?.centreHole && (o.id === "plate-spigot" || !!g()?.raisedSpigot));
select("Fit mode", () => ts.fitMode.options, () => settings.fitMode, (v) => { settings.fitMode = v; fixSettings(); }, undefined, fitOk);
select("Spigot", () => ts.spigotStyle.options, () => settings.spigotStyle, (v) => (settings.spigotStyle = v), () => settings.fitMode !== "plate");
const hasPockets = () => settings.fitMode !== "plate" && !!(g()?.centreHole?.wallPockets || (settings.fitMode === "plate-spigot-collar" && g()?.raisedSpigot?.wallPockets));
check("Wall keys (fit the flange pockets)", () => settings.wallKeys, (v) => (settings.wallKeys = v), () => !hasPockets());
slider("Thickness (mm)", ts.thickness, () => settings.thickness, (v) => (settings.thickness = v));
slider("Plate edge margin (mm)", ts.plateEdgeMargin, () => settings.plateMargin, (v) => (settings.plateMargin = v));
select("Dowel", () => ts.dowel.mode.options, () => settings.dowelMode, (v) => (settings.dowelMode = v), () => !!g()?.locatingPin, (o) => !(o.id === "printedPin" && settings.fitMode === "plate"));
select("Screw head seat", () => ts.screwClearance.headSeat.options, () => settings.headSeat, (v) => (settings.headSeat = v));
const T = (k, label, used) => slider(label, tolCfg[k], () => settings.tolerances[k], (v) => (settings.tolerances[k] = v), used);
T("screwHole", "Screw hole tolerance (mm)");
T("spigot", "Spigot tolerance (mm)", () => settings.fitMode !== "plate");
T("collar", "Collar tolerance (mm)", () => settings.fitMode === "plate-spigot-collar");
T("dowelHole", "Dowel hole tolerance (mm)", () => settings.dowelMode === "hole" && !!g()?.locatingPin);
T("dowelPin", "Printed dowel tolerance (mm)", () => settings.dowelMode === "printedPin");
check("Chamfer, faces toward the robot", () => settings.chamfer.robotFacing, (v) => (settings.chamfer.robotFacing = v));
check("Chamfer, faces away from the robot", () => settings.chamfer.awayFacing, (v) => (settings.chamfer.awayFacing = v));
slider("Chamfer size (mm)", ts.chamfer.size, () => settings.chamfer.size, (v) => (settings.chamfer.size = v), () => true, () => !advanced);
check("Advanced mode (type any value)", () => advanced, (v) => { advanced = v; if (!v) settings.chamfer.size = ts.chamfer.size.default; });
$("top").append($("controls").lastElementChild);

// ---------- local flange form ----------
const fields = [["name", "Name (e.g. My robot)", "text"], ["pcd", "Pitch circle diameter", "number"], ["thread", "Screw thread", "M3,M4,M5,M6,M8,M10,M12"], ["threadDepth", "Thread depth", "number"],
  ["positions", "Number of hole positions on the circle", "number"], ["pinD", "Locating pin hole diameter (empty = no pin; it takes position 0)", "number?"], ["pinDepth", "Pin hole depth", "number?"],
  ["spigotD", "Raised spigot diameter (empty = none)", "number?"], ["spigotH", "Raised spigot height", "number?"], ["centreD", "Centre hole diameter (empty = none)", "number?"], ["centreDepth", "Centre hole depth", "number?"],
  ["outerD", "Flange outer diameter (needed when there is no raised spigot)", "number?"]];
const dlg = document.createElement("dialog"); dlg.innerHTML = "<b>Create local robotic flange</b><div id='ff'></div><div id='fe' class='bad'></div><button id='fs'>Save</button><button id='fc'>Cancel</button>"; document.body.append(dlg);
$("ff").innerHTML = fields.map(([k, l, t]) => `<label>${l}${t.includes(",") ? `<select id="f_${k}">${t.split(",").map((o) => `<option>${o}</option>`).join("")}</select>` : `<input id="f_${k}" type="${t.startsWith("number") ? "number" : "text"}" step="any">`}</label>`).join("");
const fv = (k) => $("f_" + k).value, fn = (k) => (fv(k) === "" ? null : +fv(k));
const addBtn = Object.assign(document.createElement("button"), { textContent: "Create local robotic flange" }); addBtn.onclick = () => dlg.showModal(); $("controls").append(addBtn);
$("fc").onclick = () => dlg.close();
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
  const f = { id: "custom-" + Date.now(), brand: "Custom", model: fv("name"), geometry }; flanges.push(f);
  localStorage.setItem("customFlanges", JSON.stringify(flanges.filter((x) => x.brand === "Custom"))); cur.flange = f; fixSettings(); dlg.close(); refreshAll(); schedule();
};

// ---------- viewer ----------
const view = $("view"), renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio); view.append(renderer.domElement);
const scene = new THREE.Scene();
const setTheme = (light) => { document.body.classList.toggle("light", light); scene.background = new THREE.Color(light ? 0xf4f4f4 : 0x1e1f22); localStorage.setItem("theme", light ? "light" : "dark"); };
const tb = Object.assign(document.createElement("button"), { textContent: "Light / dark" }); tb.onclick = () => setTheme(!document.body.classList.contains("light"));
Object.assign(tb.style, { position: "absolute", top: "8px", right: "8px" }); view.append(tb); setTheme(localStorage.getItem("theme") === "light");const cam = new THREE.PerspectiveCamera(40, 1, 1, 2000); cam.up.set(0, 0, 1); cam.position.set(90, -90, 70);
new OrbitControls(cam, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.2)); const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(50, -80, 120); scene.add(dl);
const grid = new THREE.GridHelper(200, 20, 0x999999, 0xcccccc); grid.rotation.x = Math.PI / 2; scene.add(grid); scene.add(new THREE.AxesHelper(30));
let mesh = null;
const resize = () => { renderer.setSize(view.clientWidth, view.clientHeight); cam.aspect = view.clientWidth / view.clientHeight; cam.updateProjectionMatrix(); };
addEventListener("resize", resize); resize(); (function loop() { requestAnimationFrame(loop); renderer.render(scene, cam); })();
function show(m) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(m.v, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(m.n, 3)); bg.setIndex(new THREE.BufferAttribute(m.t, 1));
  mesh = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0x4a7fb5, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide })); scene.add(mesh);
}

// ---------- build / export ----------
function schedule() { clearTimeout(timer); timer = setTimeout(build, 250); }
function build() { $("status").textContent = "Building…"; worker.postMessage({ type: "build", id: ++reqId, flange: JSON.parse(JSON.stringify(cur.flange)), settings: structuredClone(settings) }); }
worker.onmessage = (e) => {
  const m = e.data;
  if (m.exported) { const url = URL.createObjectURL(new Blob([m.data])); Object.assign(document.createElement("a"), { href: url, download: `tool_start_${cur.flange.id}.${m.format}` }).click(); return; }
  if (m.id !== reqId) return;
  $("status").textContent = m.ok ? "Ready" : "Cannot build";
  $("msg").innerHTML = [...(m.errors || []).map((x) => `<div class="bad">✖ ${x}</div>`), ...(m.warnings || []).map((x) => `<div class="warn">⚠ ${x}</div>`)].join("");
  if (m.ok) show(m.mesh);
};
document.querySelectorAll("button[data-f]").forEach((b) => (b.onclick = () => worker.postMessage({ type: "export", id: reqId, format: b.dataset.f })));
refreshAll(); build();

initFooterLinks(); 