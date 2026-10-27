// Stage A (tab 1 Robot side): robot and flange menus, fit, tolerances, chamfer, export. The geometry is built in the worker (cad.js).
import * as THREE from "three";
import flangeData from "../../data/flanges.json";
import ts from "../../data/toolStart.json";
import exportCfg from "../../data/export.json";
import { section, help, line, download, numberRow, recNote, plainLabel as plain } from "../ui.js";
import { serial } from "../rpc.js";
import { record } from "../history.js";
import { store } from "../store.js";
import { meshFrom } from "../viewer.js";
import { initFlangeForm } from "./flangeForm.js";

export function initToolStart({ geo, $, startGroup, list }) {
  // saved custom flanges: a broken or old entry is skipped instead of stopping the app
  const saved = store.json("customFlanges", []), savedFlanges = Array.isArray(saved) ? saved.filter((f) => f?.id && f.geometry?.pitchCircleDiameter > 0 && f.geometry.threadedHoles) : [];
  const flanges = [...flangeData.flanges, ...savedFlanges];
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
    const s = document.createElement("select"); let sig = null;
    const fill = () => { // the option list is rebuilt only when it changed
      const opts = getOpts().map((o) => ({ id: o.id ?? o, label: o.label ?? o, ok: optOk(o) })), k = JSON.stringify(opts);
      if (k !== sig) { sig = k; s.innerHTML = ""; opts.forEach((o) => { const op = new Option(o.label, o.id); op.disabled = !o.ok; s.add(op); }); }
      s.value = get();
    };
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

  // robot menus: brand, then model
  const ADD = { id: "__add", label: "+ Add custom flange…" };
  const openForm = initFlangeForm(Object.keys(ts.screwClearance.headDiameterByScrew), (f) => {
    flanges.push(f);
    if (!store.set("customFlanges", JSON.stringify(flanges.filter((x) => x.custom || x.brand === "Custom")))) $("msg").replaceChildren(line("warn", "⚠ This browser blocks storage: the custom flange works now but is gone after a reload."));
    cur.flange = f; fixSettings(); refreshAll(); schedule();
  }, refreshAll);
  const brands = () => [...new Set(flanges.map((f) => f.brand)), ADD];
  const models = () => flanges.filter((f) => f.brand === cur.flange.brand);
  sec("Robot");
  select("Brand", brands, () => cur.flange.brand, (v) => { if (v === ADD.id) return openForm(); cur.flange = flanges.find((f) => f.brand === v && ready(f)) ?? flanges.find((f) => f.brand === v); fixSettings(); }, undefined, (b) => b.id === ADD.id || flanges.some((f) => f.brand === b && ready(f)));
  select("Robot model", () => [...models().map((f) => ({ id: f.id, label: f.model + (ready(f) ? "" : " (data needed)") })), ADD], () => cur.flange.id,
    (v) => { if (v === ADD.id) return openForm(); cur.flange = flanges.find((f) => f.id === v); fixSettings(); }, undefined, (o) => o.id === ADD.id || ready(flanges.find((f) => f.id === o.id)));
  const hasSocket = () => g()?.centreHole?.depth > 0; // a centre hole without a known depth only cuts the Plate hole
  function fixSettings() { if (settings.fitMode === "plate-spigot" && !hasSocket()) settings.fitMode = "plate"; if (settings.fitMode === "plate-spigot-collar" && !(hasSocket() && g()?.raisedSpigot)) settings.fitMode = "plate"; if (settings.fitMode === "plate") settings.dowelMode = "hole"; }
  const fitOk = (o) => o.id === "plate" || (hasSocket() && (o.id === "plate-spigot" || !!g()?.raisedSpigot));
  sec("Fit");
  select("Fit mode", () => ts.fitMode.options, () => settings.fitMode, (v) => { settings.fitMode = v; fixSettings(); }, undefined, fitOk, "fitMode");
  select("Spigot", () => ts.spigotStyle.options, () => settings.spigotStyle, (v) => (settings.spigotStyle = v), undefined, undefined, "spigot"); // in Plate mode: Full = closed plate
  const hasPockets = () => settings.fitMode !== "plate" && !!(g()?.centreHole?.wallPockets || (settings.fitMode === "plate-spigot-collar" && (g()?.raisedSpigot?.wallPockets || g()?.raisedSpigot?.wallFlats)));
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
  document.addEventListener("advanced", (e) => { if (e.detail.stage !== "A") return; advanced = e.detail.on; if (!advanced) settings.chamfer.size = ts.chamfer.size.default; refreshAll(); schedule(); });
  const stageA = ["controls", "msg", "exportA"].map($);
  document.addEventListener("stage", (e) => stageA.forEach((el) => (el.style.display = e.detail === "A" ? "" : "none")));

  // ---------- the robot side in the 3D view ----------
  let mesh = null;
  function show(m) {
    if (mesh) { startGroup.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
    mesh = meshFrom(m, new THREE.MeshStandardMaterial({ color: 0x4a7fb5, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide })); mesh.userData.base = true;
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
  ex.querySelectorAll("button[data-f]").forEach((b) => (b.onclick = () => { // same writer as stage 5, at its default resolution
    const q = exportCfg.resolution.options.find((o) => o.id === exportCfg.resolution.default);
    geo("exportScene", { format: b.dataset.f, tol: q.toleranceMm, ang: (q.angleDeg * Math.PI) / 180, items: [{ name: "Robot side", src: "start" }], base: `robot_side_${cur.flange.id}` },
      (m) => (m.ok ? download(m.file, m.data) : $("msg").replaceChildren(line("bad", "✖ " + m.error))));
  }));
  refreshAll(); build();

  return {
    getInfo: () => startInfo, // last good build: view mesh and sizes (stages 3 and 5 use it)
    flangeId: () => cur.flange.id,
    check: () => (startOk ? null : $("status").textContent === "Building…" ? "Building the robot side…" : "The robot side cannot be built. See the message above."),
  };
}
