// Stage C: connect surfaces, voxel design space, topology optimization with live preview.
import * as THREE from "three";
import tc from "../data/toolConnect.json";
import { solidCentroid } from "./voxelize.js";
import { help, segmented, toggle, section } from "./ui.js";

export function initToolConnect({ scene, cam, renderer, $, toolEnd, getStart, list }) {
  const dom = renderer.domElement;
  const ADV = { budget: tc.analysisVoxelBudget.default, rmin: tc.filterRadius.default, iters: tc.maxIterations.default, mass: tc.payloadMassKg.default, accel: tc.accelFactor.default, gdir: tc.gravityDirection.default, fx: 0, fy: 0, fz: 0, sp: tc.smooth.passes.default, bh: tc.bridge.voxelSizeMm.default };
  const S = { conn: tc.toolStartConnection.default, h: tc.refinement.draftVoxelMm, vt: tc.voxelTarget.default, band: tc.designSpace.default, ref: tc.refinement.default, vf: tc.volumeFraction.default, print: tc.printReady.default, bd: tc.bolt.diameterAdjustMm.default, bl: tc.bolt.lengthAdjustMm.default, bshape: tc.bolt.shape.default, bslot: tc.bolt.slotLengthMm.default, method: tc.method.default, waist: tc.bridge.waistPercent.default, ...ADV };
  let advanced = false, active = false, running = false, worker = null, reqId = 0, optId = 0, timer = null, secPerElem = null, lastStats = null, tStart = 0;
  let bridged = false, chain = false, sag = null, arrow = null, cog = null; // chain: Generate runs optimize → clearance → refine in one go
  let clickMode = "connect", prev = [], result = null, ghost = null, gid = 0, canClear = false, refined = false, coarseGhost = null, predGen = null, predRef = null;
  // time estimate = measured matrix speed × work × a factor; the factor is learned from the last finished run on this computer
  const calib = { gen: 1, ref: 1 };
  try { Object.assign(calib, JSON.parse(localStorage.getItem("connCalib") || "{}")); } catch (e) { /* no storage */ }
  const learn = (key, actualMs, predMs) => { if (!(predMs > 0)) return; calib[key] = Math.min(20, Math.max(0.2, actualMs / predMs)); try { localStorage.setItem("connCalib", JSON.stringify(calib)); } catch (e) { /* ignore */ } };
  const refWork = (count, its) => count * (tc.estimate.cgIterationsPerStep * its + tc.refine.firstStepCgIterations) * tc.refine.overheadFactor; // × secPerElem × 1000 = ms before learning
  const picked = []; // green faces on any tool object: { key, it (list row), obj (its 3D group), fi (face), ov (green overlay) }
  const robot = { mm: tc.avoid.robotOffsetMm.default }; // "Flange Clearance": offset of the always-red cylinder below the tool start
  const avoid = []; // red items: { key, kind: "obj" | "face", it (list row), obj (its 3D group), fi (face), mm, ov (red overlay) }
  const panel = document.createElement("div"); panel.style.display = "none"; $("exportA").after(panel);
  let host = panel; // controls are added to the current section body
  const refreshers = [], sync = () => refreshers.forEach((f) => f());
  const clamp = (v, c) => Math.min(c.max, Math.max(c.min, v));
  const schedule = () => { if (running) return; clearTimeout(timer); timer = setTimeout(run, 300); };
  const fmt = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
  const head = (t) => { const b = document.createElement("div"); b.textContent = t; b.style.cssText = "font-weight:700;margin:14px 0 4px"; host.append(b); return b; };

  const btn = (label, fn) => Object.assign(document.createElement("button"), { textContent: label, onclick: fn });

  // ---------- panel ----------
  document.addEventListener("advanced", (e) => {
    if (e.detail.stage !== "C") return;
    advanced = e.detail.on;
    if (!advanced) { S.vf = clamp(S.vf, tc.volumeFraction); S.band = clamp(S.band, tc.designSpace); S.vt = clamp(S.vt, tc.voxelTarget); Object.assign(S, ADV); applyRef(S.ref); avoid.forEach((en) => (en.mm = clamp(en.mm, cfgOf(en)))); robot.mm = clamp(robot.mm, tc.avoid.robotOffsetMm); S.bd = clamp(S.bd, tc.bolt.diameterAdjustMm); S.bl = clamp(S.bl, tc.bolt.lengthAdjustMm); S.bslot = clamp(S.bslot, tc.bolt.slotLengthMm); S.waist = clamp(S.waist, tc.bridge.waistPercent); drawRobot(); renderAvoid(); }
    sync(); schedule();
  });
  const group = (from) => { const w = document.createElement("div"); w.append(...[...host.children].slice(from)); host.append(w); return w; }; // wraps what was added since `from`, to show or hide it per method
  const prep = section("Preparation"); panel.appendChild(prep.box); host = prep.body;

  head("Robot side surface");
  const sel = document.createElement("select");
  tc.toolStartConnection.options.forEach((o) => sel.add(new Option(o.label, o.id)));
  sel.onchange = () => { S.conn = sel.value; schedule(); };
  host.append(sel);

  head("Click tool").append(help("clickTool"));
  const tool = segmented([{ id: "connect", label: "Connect face" }, { id: "face", label: "Avoid face" }, { id: "object", label: "Avoid object" }], (id) => { clickMode = id; });
  tool.set(clickMode); host.append(tool.el);

  head("Connection faces");
  const connBox = document.createElement("div"); connBox.style.cssText = "font-size:12px";
  host.append(connBox, btn("Clear connection faces", () => { picked.splice(0).forEach(dropEntry); renderAvoid(); sync(); schedule(); }));
  head("Avoid objects");
  const objBox = document.createElement("div"); objBox.style.cssText = "font-size:12px"; host.append(objBox);
  head("Avoid faces");
  const faceBox = document.createElement("div"); faceBox.style.cssText = "font-size:12px";
  host.append(faceBox, btn("Clear avoided", () => { avoid.splice(0).forEach(dropEntry); renderAvoid(); schedule(); }));
  head("Bolt Clearance").append(help("boltClearance"));
  const boltInfo = document.createElement("div"); boltInfo.style.cssText = "font-size:12px;margin-bottom:4px"; host.append(boltInfo);
  absRow("Diameter (mm)", tc.bolt.diameterAdjustMm, "bd", () => getStart()?.dims.headD ?? null);
  absRow("Height (mm)", tc.bolt.lengthAdjustMm, "bl", () => { const sc = getStart()?.dims.screws; return sc?.headH != null ? sc.headH + tc.bolt.lengthMarginMm : null; });
  const bsRow = document.createElement("div"); bsRow.className = "row"; bsRow.innerHTML = "<label>Shape</label>";
  const bsSel = document.createElement("select"); tc.bolt.shape.options.forEach((o) => bsSel.add(new Option(o.label, o.id)));
  bsSel.onchange = () => { S.bshape = bsSel.value; sync(); drawRobot(); schedule(); };
  bsRow.append(bsSel); host.append(bsRow);
  refreshers.push(() => (bsSel.value = S.bshape));
  numRow("Slot length (mm)", tc.bolt.slotLengthMm, "bslot", () => S.bshape !== "slot");
  host.append(btn("Reset bolt clearance", () => { S.bd = tc.bolt.diameterAdjustMm.default; S.bl = tc.bolt.lengthAdjustMm.default; S.bshape = tc.bolt.shape.default; S.bslot = tc.bolt.slotLengthMm.default; sync(); drawRobot(); schedule(); }));
  refreshers.push(() => { const b = keepOut()?.bolts, sc = b?.filter((x) => !x.pin), pin = b?.find((x) => x.pin); boltInfo.textContent = b ? `Above each of the ${sc.length} screws${S.bshape === "slot" ? `, as a slot running ${S.bslot} mm outward` : ""}.` + (pin ? ` Above the dowel: Ø ${(2 * pin.r).toFixed(2)} mm.` : "") : "No screw data for this flange."; });
  const cfgOf = (en) => (en.kind === "face" ? tc.avoid.faceExtrudeMm : tc.avoid.objectGrowMm);
  function renderAvoid() {
    prunePicked(); pruneAvoid(); connBox.innerHTML = objBox.innerHTML = faceBox.innerHTML = "";
    const addRow = (box, text, c, get, set, unit, onRemove) => {
      const row = document.createElement("div"); row.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:3px 0";
      const lab = document.createElement("span"); lab.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"; lab.textContent = text; row.append(lab);
      if (c) {
        lab.title = c.note;
        const n = Object.assign(document.createElement("input"), { type: "number", step: c.step, value: get() }); n.style.width = "64px";
        n.onchange = () => { let v = +n.value; if (n.value === "" || isNaN(v) || v < 0) { n.value = get(); return; } if (!advanced) v = clamp(v, c); set(v); n.value = v; schedule(); };
        const u = document.createElement("span"); u.textContent = unit; row.append(n, u);
      }
      if (onRemove) { const x = btn("✕", onRemove); x.title = "Remove"; row.append(x); }
      box.append(row);
    };
    if (!picked.length) { const e = document.createElement("div"); e.className = "rec"; e.textContent = "None yet. Pick \"Connect face\" above and click a face of a tool object."; connBox.append(e); }
    picked.forEach((p) => addRow(connBox, `Face ${p.fi + 1} of ${p.it.name}`, null, null, null, null, () => { picked.splice(picked.indexOf(p), 1); dropEntry(p); renderAvoid(); sync(); schedule(); }));
    addRow(objBox, "Flange Clearance (below the robot side)", tc.avoid.robotOffsetMm, () => robot.mm, (v) => { robot.mm = v; drawRobot(); }, "mm offset");
    avoid.forEach((en) => addRow(
      en.kind === "face" ? faceBox : objBox,
      en.kind === "face" ? `Face ${en.fi + 1} of ${en.it.name}` : en.it.name,
      cfgOf(en), () => en.mm, (v) => (en.mm = v), en.kind === "face" ? "mm gap out" : "mm gap",
      () => { avoid.splice(avoid.indexOf(en), 1); dropEntry(en); renderAvoid(); schedule(); }));
    const loose = list.items().filter((i) => i.deletable !== false && !picked.some((p) => p.it === i) && !avoid.some((en) => en.it === i));
    if (loose.length) {
      const w = document.createElement("div"); w.className = "warn"; w.style.marginTop = "6px";
      w.textContent = `⚠ Not connected and not avoided: ${loose.map((i) => i.name).join(", ")}. The connector may grow through ${loose.length > 1 ? "them" : "it"}. Use "Avoid object" to keep it clear.`;
      objBox.append(w);
    }
  }

  // Flange Clearance: red cylinder under the tool start (plate diameter + offset), and the always-blocked tool start cylinder
  const robotMat = new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const robotGroup = new THREE.Group(); scene.add(robotGroup);
  const robotRow = list.add({ name: "Flange Clearance", object: robotGroup, deletable: false });
  list.setVis(robotRow, 2); // hidden until step 3 (Generate)
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const boltGroup = new THREE.Group(); scene.add(boltGroup);
  const boltRow = list.add({ name: "Bolt Clearance", object: boltGroup, deletable: false });
  list.setVis(boltRow, 2);
  function keepOut() { // plate cylinder from the bottom of the tool start up to the top face; robot cylinder below it
    const st = getStart(); if (!st) return null;
    const v = st.mesh.v; let zMin = Infinity; for (let i = 2; i < v.length; i += 3) zMin = Math.min(zMin, v[i]);
    const R = st.dims.plateOuter / 2, sc = st.dims.screws, t = st.dims.thickness;
    const bolts = [];
    if (sc && sc.headH) {
      const len = Math.max(0.1, sc.headH + tc.bolt.lengthMarginMm + S.bl), slot = S.bshape === "slot" ? Math.max(0, S.bslot) : 0, r = Math.max(0.1, (st.dims.headD + S.bd) / 2);
      sc.angles.forEach((a) => bolts.push({ x: sc.pcdR * Math.cos((a * Math.PI) / 180), y: sc.pcdR * Math.sin((a * Math.PI) / 180), r, z0: t, z1: t + len, len: slot, pin: false }));
      if (st.dims.pinHole) bolts.push({ x: sc.pcdR, y: 0, r: Math.max(0.1, (st.dims.dowelD + tc.bolt.diameterMarginMm + S.bd) / 2), z0: t, z1: t + len, len: slot, pin: true }); // the dowel sits on the pitch circle at angle 0
    }
    return { R, zTop: t, zMin, robotR: R + robot.mm, bolts: bolts.length ? bolts : null, bed: S.print };
  }
  function drawRobot() {
    robotGroup.children.slice().forEach((m) => { robotGroup.remove(m); m.geometry.dispose(); });
    const k = keepOut(); if (!k) return;
    const cyl = (r, z0, z1) => { const g = new THREE.CylinderGeometry(r, r, z1 - z0, 64); g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2); const m = new THREE.Mesh(g, robotMat); m.raycast = () => {}; robotGroup.add(m); };
    cyl(k.R, k.zMin, k.zTop); cyl(k.robotR, k.zMin - tc.avoid.robotLengthMm, k.zMin);
    boltGroup.children.slice().forEach((m) => { boltGroup.remove(m); m.geometry.dispose(); });
    for (const b of k.bolts || []) {
      const a = Math.atan2(b.y, b.x), ex = b.x + Math.cos(a) * b.len, ey = b.y + Math.sin(a) * b.len, sh = new THREE.Shape(); // slot outward from the bolt
      sh.moveTo(b.x - Math.sin(a) * b.r, b.y + Math.cos(a) * b.r); sh.lineTo(ex - Math.sin(a) * b.r, ey + Math.cos(a) * b.r);
      sh.absarc(ex, ey, b.r, a + Math.PI / 2, a - Math.PI / 2, true); sh.lineTo(b.x + Math.sin(a) * b.r, b.y - Math.cos(a) * b.r);
      sh.absarc(b.x, b.y, b.r, a - Math.PI / 2, a + Math.PI / 2, true);
      const g = new THREE.ExtrudeGeometry(sh, { depth: b.z1 - b.z0, bevelEnabled: false, curveSegments: 24 }); g.translate(0, 0, b.z0);
      const m = new THREE.Mesh(g, boltMat); m.raycast = () => {}; boltGroup.add(m);
    }
  }
  document.addEventListener("startbuilt", () => { drawRobot(); if (active) schedule(); });
  drawRobot();

  // like numRow, but shows the real size (base + adjust); the json still stores the adjust range
  function absRow(label, cfg, key, base) {
    const d = document.createElement("div"); d.className = "row";
    const l = Object.assign(document.createElement("label"), { textContent: label });
    const r = Object.assign(document.createElement("input"), { type: "range", step: cfg.step });
    const n = Object.assign(document.createElement("input"), { type: "number", step: cfg.step });
    const rnd = (v) => Math.round(v * 100) / 100, rec = cfg.recommendedRange;
    r.oninput = () => { const b = base(); if (b == null) return; S[key] = rnd(+r.value - b); sync(); drawRobot(); }; r.onchange = () => schedule();
    n.onchange = () => { const b = base(); let v = +n.value; if (b == null || n.value === "" || isNaN(v)) return; v -= b; if (!advanced) v = clamp(v, cfg); S[key] = rnd(v); sync(); drawRobot(); schedule(); };
    d.append(l, r, n); host.append(d);
    refreshers.push(() => {
      const b = base(); d.classList.toggle("off", b == null); if (b == null) return;
      r.min = rnd(b + cfg.min); r.max = rnd(b + cfg.max); r.value = n.value = rnd(b + S[key]);
      n.className = rec ? (S[key] >= rec[0] && S[key] <= rec[1] ? "ok" : "warn") : "";
    });
  }
  function numRow(label, cfg, key, hidden = () => false, rerun = true, helpId) {
    const d = document.createElement("div"); d.className = "row";
    const l = Object.assign(document.createElement("label"), { textContent: label });
    const r = Object.assign(document.createElement("input"), { type: "range", min: cfg.min, max: cfg.max, step: cfg.step });
    const n = Object.assign(document.createElement("input"), { type: "number", step: cfg.step });
    const note = document.createElement("div"); note.className = "rec";
    const rec = cfg.recommendedRange; note.textContent = (rec ? `recommended ${rec[0]} to ${rec[1]}. ` : "") + (cfg.note ?? "");
    r.oninput = () => { S[key] = +r.value; sync(); if (key === "bslot") drawRobot(); }; r.onchange = () => rerun && schedule();
    n.onchange = () => { let v = +n.value; if (n.value === "" || isNaN(v)) return; if (!advanced) v = clamp(v, cfg); S[key] = v; sync(); if (key === "bslot") drawRobot(); if (rerun) schedule(); };
    if (helpId) l.append(help(helpId)); d.append(l, r, n, note); host.append(d);
    refreshers.push(() => { r.value = n.value = S[key]; d.style.display = hidden() ? "none" : ""; n.className = rec ? (S[key] >= rec[0] && S[key] <= rec[1] ? "ok" : "warn") : ""; });
  }
  const pr = toggle("Printable without supports (test)", (v) => { S.print = v; schedule(); }, "printable"); host.append(pr.el);
  const gen = section("Generation"); panel.appendChild(gen.box); host = gen.body;
  const meth = segmented([{ id: "bridge", label: "Bridge" }, { id: "optimize", label: "Voxel" }], (id) => {
    S.method = id; refined = false; refOut.textContent = ""; clearCoarseGhost(); clearPrev(); clearResult(); lastStats = null; setInfo("", ""); sync(); run();
  });
  host.append(meth.el);
  const fromOpt = host.children.length;
  head("Voxels");
  numRow("Design space size", tc.designSpace, "band");
  numRow("Max analysis voxels", tc.analysisVoxelBudget, "budget", () => !advanced);
  head("Design");
  // Refinement ladder. Draft = design + clearance. Normal and Fine = Refine step on the Draft design at a finer voxel
  // (Fine = voxel target, Normal = halfway). A level unlocks when the one before it has finished; finished levels are kept.
  const levels = tc.refinement.levels.map((l) => l.id), lvlName = (id) => tc.refinement.levels.find((l) => l.id === id).label;
  const lvlVoxel = (id) => (id === "fine" ? S.vt : id === "normal" ? (tc.refinement.draftVoxelMm + S.vt) / 2 : tc.refinement.draftVoxelMm);
  const applyRef = (id) => { S.ref = id; S.h = lvlVoxel(id); };
  let reached = {}, gens = {}, workerLevel = null, levelWarn = "", lastDesignSig = null, lastVt = S.vt, runSig = null; // gens[level] = { mesh, vol, over, sag }; workerLevel = level the worker holds now
  const qRow = document.createElement("div"); qRow.className = "row"; qRow.innerHTML = "<label>Refinement</label>"; qRow.firstChild.append(help("refinement"));
  const refSeg = segmented(tc.refinement.levels.map((l) => ({ id: l.id, label: l.label })), (id) => selectLevel(id));
  const lvlHint = document.createElement("div"); lvlHint.className = "rec";
  qRow.append(refSeg.el, lvlHint); host.append(qRow);
  numRow("Voxel target size (mm)", tc.voxelTarget, "vt", undefined, false, "voxelTarget");
  function resetLevels(msg) { const had = Object.values(reached).some(Boolean); reached = {}; gens = {}; workerLevel = null; applyRef(levels[0]); levelWarn = had ? msg : ""; }
  function storeGen(level, mesh, t, sg) { // a level finished: keep its result so you can switch back to it
    gens[level] = { mesh, vol: t.volCm3, over: t.overhang, sag: sg }; workerLevel = level;
    if (t.connected) reached[level] = true; sync();
  }
  function selectLevel(id) {
    applyRef(id); const g = gens[id];
    if (id === levels[0] && g && workerLevel !== id && worker) { refOut.textContent = "Going back to the Draft…"; worker.postMessage({ type: "restore" }); } // the worker holds the Draft design; this also re-clears it
    else if (g) { clearCoarseGhost(); showResult(g.mesh); vol = g.vol; over = g.over; sag = g.sag; canClear = true; showSummary(); }
    sync();
  }
  refreshers.push(() => {
    const dsig = JSON.stringify([S.vf, S.rmin, S.iters, S.budget, S.mass, S.accel, S.gdir, S.fx, S.fy, S.fz]);
    if (lastDesignSig !== null && dsig !== lastDesignSig && reached.draft) resetLevels("⚠ A design or load setting changed after the Draft, so Normal and Fine are locked again. Generate the Draft again.");
    lastDesignSig = dsig;
    if (S.vt !== lastVt) {
      lastVt = S.vt;
      if (gens.normal || gens.fine) { delete gens.normal; delete gens.fine; delete reached.normal; delete reached.fine; levelWarn = "⚠ The voxel target size changed, so Normal and Fine need to be refined again."; if (S.ref !== levels[0]) setTimeout(() => selectLevel(levels[0])); }
    }
    if (S.ref !== levels[0]) S.h = lvlVoxel(S.ref);
    levels.forEach((id, i) => refSeg.enable(id, i === 0 || !!reached[levels[i - 1]], i ? `Finish ${lvlName(levels[i - 1])} first: ${lvlName(id)} refines the ${lvlName(levels[0])} design and needs ${lvlName(levels[i - 1])} done.` : ""));
    refSeg.set(S.ref);
    lvlHint.className = levelWarn ? "warn" : "rec";
    lvlHint.textContent = levelWarn || (!reached.draft ? "↳ Finish Draft to unlock Normal." : !reached.normal ? "↳ Finish Normal to unlock Fine." : "↳ All levels done. Click a level to switch between the results.");
    const lv = S.ref, ok = lv === levels[0] ? !!lastStats : !!(lastStats && reached[levels[levels.indexOf(lv) - 1]] && canClear && canRefine());
    bGo.textContent = lv === levels[0] ? "Generate Draft" : (gens[lv] ? "Re-run " : "Refine to ") + lvlName(lv);
    if (!running) bGo.disabled = !ok;
  });
  // what the design space depends on: used to keep results when you come back to this tab without changing anything
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const inputSig = () => JSON.stringify([picked.map((p) => p.key), avoid.map((a) => [a.key, a.mm]),
    list.items().filter((i) => i.deletable !== false).map((i) => [i.id, i.object.position.toArray().map(r3), [i.object.rotation.x, i.object.rotation.y, i.object.rotation.z].map(r3)]),
    S.band, S.budget, S.print, S.conn, S.bd, S.bl, S.bshape, S.bslot, robot.mm, getStart()?.dims]);
  // Material amount (%): slider from volumeFraction, with a weight estimate (design-space volume × amount × PLA density)
  const maRow = document.createElement("div"); maRow.className = "row"; maRow.innerHTML = "<label>Material amount (%)</label>"; maRow.firstChild.append(help("materialAmount"));
  const maR = Object.assign(document.createElement("input"), { type: "range", min: tc.volumeFraction.min * 100, max: tc.volumeFraction.max * 100, step: 1 });
  const maN = Object.assign(document.createElement("input"), { type: "number", step: 1 }), maW = document.createElement("div"); maW.className = "rec";
  const setVf = (pct) => { S.vf = Math.round(pct) / 100; sync(); };
  maR.oninput = () => setVf(+maR.value);
  maN.onchange = () => { let v = +maN.value; if (maN.value === "" || isNaN(v)) return; if (!advanced) v = Math.min(tc.volumeFraction.max * 100, Math.max(tc.volumeFraction.min * 100, v)); setVf(v); };
  maRow.append(maR, maN, maW); host.append(maRow);
  const updWeight = () => {
    const pct = Math.round(S.vf * 100), rec = tc.volumeFraction.recommendedRange;
    maR.value = maN.value = pct; maN.className = S.vf >= rec[0] && S.vf <= rec[1] ? "ok" : "warn";
    maW.textContent = lastStats ? `≈ ${Math.round(lastStats.count * lastStats.h ** 3 / 1000 * S.vf * tc.material.densityGcm3)} g (design space × ${pct}% × ${tc.material.label})` : "Weight estimate appears when a design space is ready.";
  };
  refreshers.push(updWeight);
  numRow("Filter radius (voxels)", tc.filterRadius, "rmin", () => !advanced);
  numRow("Max steps", tc.maxIterations, "iters", () => !advanced);
  head("Load");
  const loadInfo = document.createElement("div"); loadInfo.style.cssText = "font-size:12px;margin-bottom:4px"; host.append(loadInfo);
  numRow("Payload mass (kg)", tc.payloadMassKg, "mass", () => !advanced, false);
  numRow("Acceleration factor", tc.accelFactor, "accel", () => !advanced, false);
  const gRow = document.createElement("div"); gRow.className = "row"; gRow.innerHTML = "<label>Load direction in the model</label>";
  const gSel = document.createElement("select"); tc.gravityDirection.options.forEach((o) => gSel.add(new Option(o, o))); gSel.onchange = () => { S.gdir = gSel.value; sync(); };
  gRow.append(gSel); host.append(gRow);
  numRow("Extra force X (N)", tc.extraForceN, "fx", () => !advanced, false);
  numRow("Extra force Y (N)", tc.extraForceN, "fy", () => !advanced, false);
  numRow("Extra force Z (N)", tc.extraForceN, "fz", () => !advanced, false);
  const GDIR = { "-X": [-1, 0, 0], "+X": [1, 0, 0], "-Y": [0, -1, 0], "+Y": [0, 1, 0], "-Z": [0, 0, -1], "+Z": [0, 0, 1] };
  const forceVec = () => { const g = GDIR[S.gdir], m = S.mass * S.accel * 9.81; return [g[0] * m + S.fx, g[1] * m + S.fy, g[2] * m + S.fz]; };
  // one force on the tool end, drawn as a yellow arrow that ends at its centre of mass
  function drawArrow() {
    if (arrow) { scene.remove(arrow); arrow.dispose(); arrow = null; }
    const F = forceVec(), n = Math.hypot(...F); if (!cog || n < 1e-9) return;
    const L = tc.arrowLengthMm, dir = new THREE.Vector3(F[0] / n, F[1] / n, F[2] / n);
    arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(...cog).addScaledVector(dir, -L), L, 0xffd600, L * 0.25, L * 0.12);
    arrow.traverse((o) => { o.raycast = () => {}; o.renderOrder = 999; if (o.material) o.material.depthTest = false; }); // drawn on top, also inside the part
    arrow.visible = active && S.method === "optimize"; scene.add(arrow);
  }
  refreshers.push(() => {
    const n = Math.hypot(...forceVec());
    loadInfo.textContent = `One force on the tool: ${n.toFixed(0)} N (${S.mass} kg × ${S.accel} × 9.81` + (S.fx || S.fy || S.fz ? " + extra" : "") + `), the yellow arrow in the 3D view.`;
    drawArrow();
  });

  const optA = group(fromOpt);
  const info = document.createElement("div"); info.style.cssText = "font-size:12px;margin:10px 0;line-height:1.5"; host.append(info);
  const setInfo = (cls, html) => { info.className = cls; info.innerHTML = html; };

  const fromBr = host.children.length;
  numRow("Waist (% narrower in the middle)", tc.bridge.waistPercent, "waist", undefined, undefined, "bridge");
  numRow("Bridge voxel size (mm)", tc.bridge.voxelSizeMm, "bh", () => !advanced);
  const brOut = document.createElement("div"); brOut.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px"; host.append(brOut);
  const brG = group(fromBr), fromOpt2 = host.children.length;
  head("Generate");
  const genNote = document.createElement("div"); genNote.className = "rec";
  genNote.textContent = "Draft: designs the connector and clears the red zones, Flange Clearance and Bolt Clearance (orange ghost = the gap around red items), drops loose pieces. Normal and Fine refine the Draft on a finer voxel.";
  host.append(genNote);
  const typ = document.createElement("div"); typ.style.cssText = "font-size:12px;margin-bottom:6px"; host.append(typ);
  const bGo = btn("Generate Draft", () => (S.ref === levels[0] ? generate() : refine())), bStop = btn("Stop", () => { chain = false; worker?.postMessage({ type: "stop" }); });
  bGo.disabled = true; bStop.disabled = true;
  const bar = Object.assign(document.createElement("progress"), { max: 1, value: 0 }); bar.style.cssText = "width:100%;margin-top:6px";
  const prog = document.createElement("div"); prog.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px";
  const clrOut = document.createElement("div"); clrOut.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px";
  const stick = document.createElement("div"); stick.style.cssText = "position:sticky;bottom:0;z-index:3;background:var(--bg);padding:6px 0;border-top:1px solid var(--line)";
  stick.append(bGo, bStop, bar); host.append(stick, prog, clrOut);
  const rfBar = Object.assign(document.createElement("progress"), { max: 1, value: 0 }); rfBar.style.cssText = "width:100%;margin-top:6px";
  const refOut = document.createElement("div"); refOut.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px";
  host.append(rfBar, refOut);
  const canRefine = () => canClear && lastStats && lastStats.h > S.h * 1.001;
  const sumOut = document.createElement("div"); sumOut.style.cssText = "font-size:13px;line-height:1.6;margin-top:8px;font-weight:600"; host.append(sumOut);
  let vol = null, over = null;
  function showSummary() { // weight and sag readout of the current result
    if (vol == null) { sumOut.textContent = ""; return; }
    const m = tc.material, F = Math.hypot(...forceVec());
    sumOut.innerHTML = [
      `Weight: about ${(vol * m.densityGcm3).toFixed(0)} g (${m.label}, solid, ${vol.toFixed(1)} cm³)`,
      sag != null ? `Sag at the tool: about ${sag < 0.01 ? sag.toPrecision(2) : sag.toFixed(2)} mm under ${F.toFixed(0)} N (rough, solid ${m.label})` : "",
      over != null ? `<span class="${over ? "warn" : "ok"}">${over ? `⚠ ${over.toLocaleString()} voxels overhang more than 45°` : "✔ No overhang above 45°: prints without supports"}</span>` : "",
    ].filter(Boolean).join("<br>");
  }

  head("Smoothing (optional)").append(help("smoothing"));
  const smRow = document.createElement("div"); smRow.className = "row"; smRow.innerHTML = "<label>Smoothing strength</label>";
  const smSel = document.createElement("select"); tc.smooth.strength.options.forEach((o) => smSel.add(new Option(o.label, o.id)));
  smSel.value = tc.smooth.strength.default; smSel.onchange = () => { S.sp = tc.smooth.strength.options.find((o) => o.id === smSel.value).passes; sync(); };
  smRow.append(smSel); host.append(smRow);
  numRow("Smoothing passes per click", tc.smooth.passes, "sp", () => !advanced, false);
  const smOut = document.createElement("div"); smOut.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px";
  const smSend = (msg, text) => { if (!worker || !canClear) return; smOut.textContent = text; worker.postMessage({ ...msg, id: ++gid }); };
  const bSmooth = btn("Smooth", () => smSend({ type: "smooth", passes: S.sp }, "Smoothing…"));
  const bUnsmooth = btn("Reset to voxels", () => smSend({ type: "smoothReset" }, "Resetting…"));
  host.append(bSmooth, bUnsmooth, smOut);
  head("Re-cut clearances").append(help("reCut"));
  const bCut = btn("Cut clearance", () => smSend({ type: "smoothClear" }, "Cutting…"));
  host.append(bCut);
  const optB = group(fromOpt2);
  refreshers.push(() => { meth.set(S.method); optA.style.display = optB.style.display = S.method === "optimize" ? "" : "none"; brG.style.display = S.method === "bridge" ? "" : "none"; });
  refreshers.push(() => {
    bSmooth.disabled = bCut.disabled = bUnsmooth.disabled = running || !canClear || workerLevel !== S.ref;
    const o = tc.smooth.strength.options.find((x) => x.passes === S.sp); if (o) smSel.value = o.id;
  });
  const selfBox = document.createElement("div"), selfOut = document.createElement("div"); selfOut.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px";
  selfBox.append(btn("Run solver self-test", () => { selfOut.textContent = "Running…"; ensureWorker().postMessage({ type: "selftest" }); }), selfOut); host.append(selfBox);
  refreshers.push(() => { sel.value = S.conn; pr.set(S.print); gSel.value = S.gdir; gRow.style.display = advanced ? "" : "none"; selfBox.style.display = advanced ? "" : "none"; });

  function setLock(on) {
    running = on; panel.querySelectorAll("input,select,button").forEach((x) => (x.disabled = on));
    bStop.disabled = !on; if (!on) { bGo.disabled = !lastStats; sync(); }
  }

  // ---------- face picking on the tool end ----------
  const hlMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
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
    if (!active || running || (e.button !== 0 && e.button !== 2) || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    prunePicked(); pruneAvoid();
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam);
    const pickable = (i) => i.deletable !== false; // the flange is never pickable here
    if (e.button === 2) { // right-click: clear whatever is under the cursor (green face, red face, red object)
      const h = pickAt(shown().filter(pickable)); if (!h) return;
      const fi = faceAt(h.it.object, h.hit);
      if (fi >= 0) { removePick(h.it, fi); removeAvoid("face", h.it, fi); }
      removeAvoid("obj", h.it, null);
      renderAvoid(); sync(); schedule(); return;
    }
    const mode = e.shiftKey ? (clickMode === "object" ? "object" : "face") : clickMode; // shift-click = quick avoid
    if (mode === "object") { const h = pickAt(shown().filter(pickable)); if (!h) return; toggleAvoid("obj", h.it, null); }
    else {
      const h = pickAt(shown().filter(pickable)); if (!h) return;
      if (!(h.it.object.userData.fg || []).length) return setInfo("bad", "✖ This part has no face data. Re-add it in step 2.");
      const fi = faceAt(h.it.object, h.hit); if (fi < 0) return;
      if (mode === "connect") toggleConnect(h.it, fi); else toggleAvoid("face", h.it, fi);
    }
    renderAvoid(); sync(); schedule();
  });
  // red items: a whole object (grows by mm) or one face (extruded outward by mm)
  const avMat = new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  function dropEntry(en) { if (en.ov) { en.ov.parent?.remove(en.ov); en.ov.geometry.dispose(); en.ov = null; } }
  function prunePicked() { // forget green faces of deleted rows, or whose mesh was replaced
    for (let i = picked.length - 1; i >= 0; i--) { const p = picked[i]; if (!list.items().includes(p.it) || p.it.object !== p.obj) { dropEntry(p); picked.splice(i, 1); } }
  }
  function removePick(it, fi) { // fi null = every green face of this object
    for (let i = picked.length - 1; i >= 0; i--) if (picked[i].it === it && (fi == null || picked[i].fi === fi)) { dropEntry(picked[i]); picked.splice(i, 1); }
  }
  function toggleConnect(it, fi) { // a face cannot be both green and red: the last click wins
    const key = "c:" + it.id + ":" + fi, at = picked.findIndex((x) => x.key === key);
    if (at >= 0) { dropEntry(picked[at]); picked.splice(at, 1); return; }
    removeAvoid("face", it, fi); removeAvoid("obj", it, null);
    const en = { key, it, obj: it.object, fi, ov: null }, g = new THREE.BufferGeometry();
    g.setAttribute("position", baseMesh(en.obj).geometry.getAttribute("position")); g.setIndex(faceIndices(en.obj, [fi]));
    en.ov = new THREE.Mesh(g, hlMat); en.obj.add(en.ov); picked.push(en);
  }
  function pruneAvoid() { // forget rows that were deleted, or whose mesh was replaced (Apply to selected primitive)
    for (let i = avoid.length - 1; i >= 0; i--) { const en = avoid[i]; if (!list.items().includes(en.it) || en.it.object !== en.obj) { dropEntry(en); avoid.splice(i, 1); } }
  }
  function removeAvoid(kind, it, fi) {
    const at = avoid.findIndex((x) => x.key === kind + ":" + it.id + ":" + fi);
    if (at >= 0) { dropEntry(avoid[at]); avoid.splice(at, 1); }
  }
  function toggleAvoid(kind, it, fi) { // a face cannot be both green and red: picking green removes red
    const key = kind + ":" + it.id + ":" + fi, at = avoid.findIndex((x) => x.key === key);
    if (at >= 0) { dropEntry(avoid[at]); avoid.splice(at, 1); return; }
    if (kind === "obj") removePick(it, null); else removePick(it, fi);
    const en = { key, kind, it, obj: it.object, fi, mm: kind === "face" ? tc.avoid.faceExtrudeMm.default : tc.avoid.objectGrowMm.default, ov: null };
    const mesh = baseMesh(en.obj), g = new THREE.BufferGeometry();
    g.setAttribute("position", mesh.geometry.getAttribute("position"));
    g.setIndex(kind === "obj" ? mesh.geometry.index : faceIndices(en.obj, [fi]));
    en.ov = new THREE.Mesh(g, avMat); en.obj.add(en.ov); avoid.push(en);
  }
  function faceInfo(part) { // replicad gives face ranges in index units; k also accepts triangle units
    const mesh = part.children[0], fg = part.userData.fg || [], nTri = mesh.geometry.index.count / 3;
    return { mesh, fg, k: fg.reduce((m, g) => Math.max(m, g.start + g.count), 0) > nTri ? 3 : 1 };
  }
  function faceIndices(part, fis) {
    const { mesh, fg, k } = faceInfo(part), src = mesh.geometry.index.array, idx = [];
    fis.forEach((fi) => { const g = fg[fi], a = (g.start / k) * 3, b = a + (g.count / k) * 3; for (let i = a; i < b; i++) idx.push(src[i]); });
    return idx;
  }
  function trisOf(mesh, ranges) { // world-space triangles (9 numbers each); ranges = [[firstIndex, lastIndex+1], ...] or null for all
    const pos = mesh.geometry.getAttribute("position"), idx = mesh.geometry.index.array, v = new THREE.Vector3(), out = [];
    for (const [a, b] of ranges ?? [[0, idx.length]]) for (let i = a; i < b; i++) { v.fromBufferAttribute(pos, idx[i]).applyMatrix4(mesh.matrixWorld); out.push(v.x, v.y, v.z); }
    return Float32Array.from(out);
  }
  function endTris(all) { // world-space triangles of every connected object (all) or of its green faces only
    const out = [];
    for (const it of new Set(picked.map((p) => p.it))) {
      it.object.updateMatrixWorld(true);
      const { mesh, fg, k } = faceInfo(it.object);
      out.push(trisOf(mesh, all ? null : picked.filter((p) => p.it === it).map((p) => [(fg[p.fi].start / k) * 3, (fg[p.fi].start / k) * 3 + (fg[p.fi].count / k) * 3])));
    }
    const res = new Float32Array(out.reduce((s, a) => s + a.length, 0)); let o = 0;
    out.forEach((a) => { res.set(a, o); o += a.length; });
    return res;
  }
  function avoidData() { // world-space triangles of every red item
    pruneAvoid();
    const items = [], tr = [];
    for (const en of avoid) {
      en.obj.updateMatrixWorld(true);
      const { mesh, fg, k } = faceInfo(en.obj), g = fg[en.fi];
      const t = trisOf(mesh, en.kind === "obj" ? null : [[(g.start / k) * 3, ((g.start + g.count) / k) * 3]]);
      items.push({ kind: en.kind, mm: en.mm, tris: t }); tr.push(t.buffer);
    }
    return { items, tr };
  }
  function startTris(info, all) { // all = whole tool start; otherwise only its top face (z = plate thickness)
    const { v, n, t } = info.mesh, z0 = info.dims.thickness, out = [];
    for (let i = 0; i < t.length; i += 3) {
      const q = [t[i], t[i + 1], t[i + 2]];
      if (!all && (n[q[0] * 3 + 2] < 0.9 || q.some((x) => Math.abs(v[x * 3 + 2] - z0) > 1e-3))) continue;
      for (const x of q) out.push(v[x * 3], v[x * 3 + 1], v[x * 3 + 2]);
    }
    return Float32Array.from(out);
  }

  // ---------- previews and result ----------
  const domMat = new THREE.MeshStandardMaterial({ color: 0x4a7fb5, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const srcMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, side: THREE.DoubleSide });
  const resMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
  const avoidMat = new THREE.MeshStandardMaterial({ color: 0xe53935, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const meshOf = (x, mat) => {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(x.p, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(x.n, 3)); bg.setIndex(new THREE.BufferAttribute(x.i, 1));
    const m = new THREE.Mesh(bg, mat); m.visible = active; scene.add(m); return m;
  };
  function clearGhost() { if (ghost) { scene.remove(ghost); ghost.geometry.dispose(); ghost = null; } }
  function clearPrev() { prev.forEach((m) => { scene.remove(m); m.geometry.dispose(); }); prev = []; clearGhost(); }
  const ghostCoarseMat = new THREE.MeshStandardMaterial({ color: 0x4a7fb5, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  function clearCoarseGhost() { if (coarseGhost) { scene.remove(coarseGhost); coarseGhost.geometry.dispose(); coarseGhost = null; } }
  function clearResult() { canClear = bridged = false; clrOut.textContent = ""; smOut.textContent = ""; vol = sag = over = null; showSummary(); if (result) { scene.remove(result); result.geometry.dispose(); result = null; } }
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0xff9800, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  function ghostPreview() { if (worker && lastStats && !running) worker.postMessage({ type: "clearPreview", id: ++gid }); }
  function applyClearance() { if (!worker || !canClear) return; clrOut.textContent = "Clearing…"; worker.postMessage({ type: "clear" }); }
  const keep = (f) => { const v = vol, s = sag, o = over; f(); vol = v; sag = s; over = o; showSummary(); }; // showResult clears the readout
  function setPrev(d, s, a) { resetLevels("⚠ The setup changed, so you start again at Draft."); refined = false; refOut.textContent = ""; clearCoarseGhost(); clearPrev(); clearResult(); prev = [meshOf(d, domMat), meshOf(s, srcMat)]; if (a && a.i.length) prev.push(meshOf(a, avoidMat)); }
  const showResult = (d) => { clearResult(); result = meshOf(d, resMat); };

  function showEstimate() {
    if (!lastStats) return;
    const s = lastStats, e = tc.estimate;
    const min = secPerElem == null ? null : (s.count * e.cgIterationsPerStep * S.iters * secPerElem * e.overheadFactor * calib.gen) / 60;
    const cls = min == null ? "" : min < e.greenBelowMinutes ? "ok" : min < e.yellowBelowMinutes ? "warn" : "bad";
    const time = min == null ? "measuring this computer…" : `about ${min < 1 ? "under 1" : min.toFixed(min < 10 ? 1 : 0)} min (rough estimate)`;
    setInfo("", [
      `Gap between the surfaces: ${s.L.toFixed(1)} mm`,
      `Design voxels: ${s.count.toLocaleString()} (grid ${s.dim.join(" × ")})`,
      `Analysis voxel: ${s.h.toFixed(2)} mm (set by the voxel limit; use Refine for a finer result)`,
      `<span class="${cls}">Estimated design time: ${time}</span>`,
      cls === "bad" ? `<span class="bad">⚠ This will be slow. Try smaller faces, a smaller design space or a larger voxel size.</span>` : "",
      avoid.length || s.nAvoided ? `<span class="${s.avoidHitsSrc ? "warn" : ""}">Avoided: ${s.nAvoided.toLocaleString()} voxels taken out of the design space (red)</span>` + (s.avoidHitsSrc ? "<br>⚠ An avoided zone touches a connect surface. The surface voxels were kept." : "") : "",
      s.overBudget ? `<span class="warn">⚠ Could not get under the voxel limit. Reduce the design space.</span>` : "",
    ].filter(Boolean).join("<br>"));
    typ.textContent = min == null ? "" : `A design typically takes about ${min < 1 ? "under 1" : min.toFixed(min < 10 ? 1 : 0)} min on this computer. It WILL be slow: leave this tab open.`;
  }
  function onMsg(e) {
    const m = e.data;
    if (m.type === "bench") { secPerElem = m.secPerElem; return showEstimate(); }
    if (m.type === "refineInfo") {
      if (m.id !== optId) return;
      const s = m.stats, e = tc.estimate, its = tc.refine.maxIterations.default;
      predRef = { count: s.count };
      const min = secPerElem == null ? null : (refWork(s.count, its) * secPerElem * calib.ref) / 60;
      const cls = min == null ? "" : min < e.greenBelowMinutes ? "ok" : min < e.yellowBelowMinutes ? "warn" : "bad";
      refOut.innerHTML = [
        `Refined voxel: ${s.h.toFixed(2)} mm` + (s.h > S.h * 1.001 ? ` (coarser than your ${S.h} mm so it fits the voxel budget)` : ""),
        `Voxels: ${s.count.toLocaleString()} (grid ${s.dim.join(" × ")})`,
        min == null ? "" : `<span class="${cls}">Estimated time: about ${min < 1 ? "under 1" : min.toFixed(min < 10 ? 1 : 0)} min (at most, rough)${calib.ref === 1 ? ". It gets more accurate after your first refine." : ""}</span>`,
        s.overBudget ? `<span class="warn">⚠ Could not get under the voxel budget. This may be slow.</span>` : "",
      ].filter(Boolean).join("<br>");
      return;
    }
    if (m.type === "restored") {
      if (!m.ok) { refOut.innerHTML = `<span class="bad">✖ ${m.error}</span>`; return; }
      clearCoarseGhost(); showResult(m.mesh); canClear = true; refined = false; workerLevel = levels[0]; refOut.innerHTML = `<span class="ok">Draft design.</span>`; sync();
      applyClearance(); // reads the weight and overhangs of the coarse result again
      return;
    }
    if (m.refine && m.type === "progress") {
      if (m.id !== optId) return;
      rfBar.value = m.it / m.maxIter;
      refOut.querySelector(".rprog")?.remove();
      const p = Object.assign(document.createElement("div"), { className: "rprog" }); p.style.marginTop = "4px";
      p.textContent = `Step ${m.it}/${m.maxIter} · ${(m.c0 / m.c).toFixed(2)}× the stiffness of the coarse design · material ${((m.vol / m.cap) * 100).toFixed(0)}% of the coarse volume · ${fmt(m.elapsed)} elapsed, about ${fmt((m.elapsed / m.it) * (m.maxIter - m.it))} left at most`;
      refOut.append(p);
      if (m.mesh) keep(() => showResult(m.mesh));
      return;
    }
    if (m.refine && m.type === "done") {
      if (m.id !== optId) return;
      setLock(false);
      if (!m.ok) { refOut.innerHTML = `<span class="bad">✖ ${m.error}</span>`; if (coarseGhost && !result) { result = coarseGhost; result.material = resMat; coarseGhost = null; } return; }
      if (!m.stopped && predRef && secPerElem != null) learn("ref", m.elapsed, refWork(predRef.count, m.it) * secPerElem * 1000);
      showResult(m.mesh); canClear = true; refined = true; rfBar.value = m.stopped ? rfBar.value : 1; if (!m.stopped) storeGen(S.ref, m.mesh, m.stats, m.sag); sync();
      const t = m.stats; vol = t.volCm3; over = t.overhang; sag = m.sag; showSummary();
      refOut.innerHTML = `<span class="${t.connected ? "ok" : "bad"}">${t.connected ? "✔" : "⚠ The robot side and the tool are no longer connected."} Refine ${m.stopped ? "stopped" : "finished"} after ${m.it} steps in ${fmt(m.elapsed)}. Voxel ${m.h.toFixed(2)} mm (analysis was ${m.hc.toFixed(2)} mm).` + (advanced ? `<br>Stiffness: ${(m.c0 / m.c).toFixed(2)}× the coarse design. Material: ${((m.vol / m.cap) * 100).toFixed(0)}% of the coarse volume. ${t.islands.toLocaleString()} loose voxels dropped.` : "") + "</span>";
      return;
    }
    if (m.type === "bridged") {
      if (m.id !== reqId) return;
      if (!m.ok) { clearResult(); brOut.innerHTML = `<span class="bad">✖ ${m.error}</span>`; return; }
      showResult(m.mesh); bridged = m.mesh.i.length > 0; sync();
      const t = m.stats; vol = t.volCm3; over = t.overhang; sag = null; showSummary();
      brOut.innerHTML = `<span class="${t.connected ? "ok" : "bad"}">${t.connected ? "✔ Bridge ready" : "⚠ The keep-outs cut the bridge: the robot side and the tool are not connected"} in ${(t.ms / 1000).toFixed(1)} s.</span>`
        + (t.waistCut ? `<br><span class="warn">Print-ready: waist lowered to ${t.waist.toFixed(0)}% so the walls do not overhang more than 45°.</span>` : "")
        + (advanced ? `<br>Voxel ${t.h.toFixed(2)} mm, ${t.tris.toLocaleString()} triangles, ${t.islands.toLocaleString()} loose cells dropped.` : "");
      return;
    }
    if (m.type === "selftest") { selfOut.innerHTML = (m.more ? selfOut.innerHTML : "") + m.results.map((r) => `<div class="${r.ok === null ? "" : r.ok ? "ok" : "bad"}">${r.ok === null ? "ℹ" : r.ok ? "✔" : "✖"} ${r.text}</div>`).join(""); return; }
    if (m.type === "clearPreview") { if (m.id === gid) { clearGhost(); if (m.mesh.i.length) ghost = meshOf(m.mesh, ghostMat); } return; }
    if (m.type === "smoothed") {
      if (m.id !== gid) return;
      if (!m.ok) { smOut.innerHTML = `<span class="bad">✖ ${m.error}</span>`; return; }
      keep(() => showResult(m.mesh)); canClear = true; sync();
      const t = m.stats; if (t.volCm3 != null) { vol = t.volCm3; over = null; showSummary(); }
      smOut.innerHTML = m.reset ? `<span class="ok">Back to voxels.</span>`
        : `<span class="${t.connected ? "ok" : "bad"}">${t.connected ? "✔" : "⚠ The robot side and the tool are no longer connected."} ${m.op === "smoothClear" ? `Cut ${t.cut.toLocaleString()} cells in the zones. ` : ""}${t.islands ? `${t.islands.toLocaleString()} loose cells dropped. ` : ""}Volume ${t.volCm3.toFixed(1)} cm³, ${t.tris.toLocaleString()} triangles.</span>`;
      return;
    }
    if (m.type === "cleared") {
      if (!m.ok) { chain = false; setLock(false); clrOut.innerHTML = `<span class="bad">✖ ${m.error}</span>`; return; }
      const t = m.stats; keep(() => showResult(m.mesh)); canClear = true;
      vol = t.volCm3; over = t.overhang; showSummary();
      clrOut.innerHTML = `<span class="${t.connected ? "ok" : "bad"}">${t.connected ? "✔ Cleared" : "⚠ The robot side and the tool are no longer connected"}: ${t.cut.toLocaleString()} voxels deleted in the zones, ${t.islands.toLocaleString()} loose voxels dropped.</span>`;
      if (chain) storeGen(levels[0], m.mesh, t, sag);
      if (chain) { chain = false; setLock(false); } else sync();
      return;
    }
    if (m.type === "progress") {
      if (m.id !== optId) return;
      bar.value = m.it / m.maxIter;
      const per = m.elapsed / m.it;
      prog.textContent = `Designing: step ${m.it}/${m.maxIter} · ${fmt(m.elapsed)} elapsed, about ${fmt(per * (m.maxIter - m.it))} left at most` + (advanced ? ` · ${(m.c0 / m.c).toFixed(1)}× stiffer than the start · material ${(m.vol * 100).toFixed(0)}% · solver ${m.cg} iterations` : "");
      if (m.mesh) showResult(m.mesh);
      return;
    }
    if (m.type === "done") {
      if (m.id !== optId) return;
      if (!m.ok) { chain = false; setLock(false); prev.forEach((x) => (x.visible = active)); prog.innerHTML = `<span class="bad">✖ ${m.error}</span>`; return; }
      showResult(m.mesh); canClear = true; bar.value = m.stopped ? bar.value : 1; sag = m.sag;
      if (!m.stopped && secPerElem != null) learn("gen", m.elapsed, predGen * (m.it / S.iters) * secPerElem * 1000);
      prog.innerHTML = `<span class="ok">Design ${m.stopped ? "stopped" : "finished"} after ${m.it} steps in ${fmt(m.elapsed)}.</span>`;
      chain = !m.stopped; clrOut.textContent = "Clearing…"; worker.postMessage({ type: "clear" }); // the voxel result is always cleared; the lock is released after it
      if (!chain) setLock(false);
      return;
    }
    if (m.id !== reqId) return; // design space result
    if (!m.ok) { lastStats = null; bGo.disabled = true; clearPrev(); return setInfo("bad", "✖ " + m.error); }
    lastStats = m.stats; bGo.disabled = false; setPrev(m.dom, m.src, m.avoid); showEstimate(); ghostPreview(); updWeight();
  }
  function ensureWorker() {
    if (!worker) { worker = new Worker(new URL("./voxelWorker.js", import.meta.url), { type: "module" }); worker.onmessage = onMsg; worker.postMessage({ type: "bench" }); }
    return worker;
  }
  function run() {
    renderAvoid(); const st = getStart();
    if (!st) return setInfo("warn", "Robot side is not ready yet.");
    if (!list.items().some((i) => i.deletable !== false)) { lastStats = null; bGo.disabled = true; cog = null; drawArrow(); clearPrev(); clearResult(); return setInfo("warn", "Add a part in step 2 (Tool) first."); }
    if (!picked.length) { cog = null; drawArrow(); lastStats = null; bGo.disabled = true; clearPrev(); clearResult(); return setInfo("warn", "Pick \"Connect face\" and click one or more faces of the tool objects. They turn green."); }
    cog = solidCentroid(endTris(true)); drawArrow();
    if (S.method === "bridge") return runBridge(st);
    ensureWorker(); bGo.disabled = true; drawRobot(); runSig = inputSig();
    const R = startR(st.dims);
    const a = startTris(st, false), b = endTris(false), sa = startTris(st, true), ea = endTris(true), av = avoidData(), ko = keepOut();
    setInfo("", "Computing design space…");
    worker.postMessage({ type: "domain", id: ++reqId, h: tc.voxelSize.min, band: S.band, budget: S.budget, maxCells: tc.maxGridCells, R, startTris: a, endTris: b, startAll: sa, endAll: ea, avoid: av.items, keepOut: ko }, [a.buffer, b.buffer, sa.buffer, ea.buffer, ...av.tr]);
  }
  const startR = (d) => (S.conn === "partial" ? (d.spigotOuter ? d.spigotOuter / 2 : d.centreHole / 2 + d.thickness) : null);
  function runBridge(st) {
    ensureWorker(); drawRobot(); clearPrev(); lastStats = null; setInfo("", "");
    const b = endTris(false), ea = endTris(true), av = avoidData(), ko = keepOut();
    brOut.textContent = "Building the bridge…";
    worker.postMessage({ type: "bridge", id: ++reqId, h: S.bh, waist: S.waist, maxCells: tc.maxGridCells, R: startR(st.dims), endTris: b, endAll: ea, avoid: av.items, keepOut: ko }, [b.buffer, ea.buffer, ...av.tr]);
  }
  function refine() {
    if (!worker || !canRefine()) return;
    const r = tc.refine, d = (k) => r[k].default;
    if (result) { clearCoarseGhost(); coarseGhost = result; coarseGhost.material = ghostCoarseMat; result = null; } // the coarse result stays visible as a transparent ghost
    setLock(true); rfBar.value = 0; refOut.textContent = "Preparing the finer grid…";
    worker.postMessage({ type: "refine", id: ++optId, h: S.h, budget: d("voxelBudget"), maxCells: tc.maxGridCells, bandVoxels: d("bandVoxels"), rmin: S.rmin, maxIter: d("maxIterations"), mass: S.mass, accel: S.accel, gdir: S.gdir, extra: [S.fx, S.fy, S.fz], shrink: { tol: d("stiffnessTolerance"), step: d("shrinkStep"), minFrac: d("minVolumeFraction") } });
  }
  function generate() {
    if (!lastStats || !worker) return;
    refined = false; refOut.textContent = ""; clearCoarseGhost(); chain = false; reached = {}; gens = {}; workerLevel = null; levelWarn = "";
    predGen = lastStats.count * tc.estimate.cgIterationsPerStep * S.iters * tc.estimate.overheadFactor; // × secPerElem × 1000 = ms before learning
    clearResult(); prev.forEach((x) => (x.visible = false));
    setLock(true); bar.value = 0; tStart = performance.now(); prog.textContent = "Starting… the first step is the slowest.";
    worker.postMessage({ type: "optimize", id: ++optId, vf: S.vf, rmin: S.rmin, maxIter: S.iters, mass: S.mass, accel: S.accel, gdir: S.gdir, extra: [S.fx, S.fy, S.fz] });
  }

  document.addEventListener("stage", (e) => {
    active = e.detail === "C"; list.setVis(robotRow, active ? 1 : 2); list.setVis(boltRow, active ? 1 : 2); if (ghost) ghost.visible = active; if (arrow) arrow.visible = active && S.method === "optimize"; if (coarseGhost) coarseGhost.visible = active; panel.style.display = active ? "" : "none";
    prev.forEach((m) => (m.visible = active && !result)); if (result) result.visible = active || e.detail === "D"; // stage D (Export) shows the connector too
    if (active) renderAvoid();
    if (active && !running) { sync(); if (S.method !== "optimize" || !lastStats || inputSig() !== runSig) run(); }
  });
  const legend = document.createElement("div"); // colour key, only in stage 3
  legend.style.cssText = "position:absolute;bottom:8px;right:8px;z-index:5;display:none;font-size:11px;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:4px 8px;line-height:1.5";
  legend.innerHTML = [["#2ecc71", "connect"], ["#e53935", "avoid, clearance"], ["#ff9800", "gap"], ["#ffd600", "load"]].map(([col, t]) => `<span style="color:${col}">■</span> ${t}`).join("<br>");
  dom.parentElement.append(legend);
  document.addEventListener("stage", (e) => { legend.style.display = e.detail === "C" ? "" : "none"; });
  renderAvoid(); sync();
  return { // used by stage D (Export)
    getResult: () => (result && !running && (canClear || bridged) && result.geometry.index ? { p: result.geometry.getAttribute("position").array, i: result.geometry.index.array } : null),
    isAvoided: (it) => avoid.some((en) => en.it === it),
  };
}