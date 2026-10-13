// Stage C: connect surfaces, voxel design space, topology optimization with live preview.
import * as THREE from "three";
import tc from "../data/toolConnect.json";

export function initToolConnect({ scene, cam, renderer, $, toolEnd, getStart }) {
  const dom = renderer.domElement;
  const ADV = { budget: tc.analysisVoxelBudget.default, rmin: tc.filterRadius.default, iters: tc.maxIterations.default, mass: tc.payloadMassKg.default, accel: tc.accelFactor.default, gdir: tc.gravityDirection.default, fx: 0, fy: 0, fz: 0 };
  const S = { conn: tc.toolStartConnection.default, h: tc.voxelSize.default, band: tc.designSpace.default, vf: tc.volumeFraction.default, ...ADV };
  let advanced = false, active = false, running = false, worker = null, reqId = 0, optId = 0, timer = null, secPerElem = null, lastStats = null, tStart = 0;
  let curPart = null, hl = null, prev = [], result = null;
  const picked = new Set();
  const panel = document.createElement("div"); panel.style.display = "none"; $("exportA").after(panel);
  const refreshers = [], sync = () => refreshers.forEach((f) => f());
  const clamp = (v, c) => Math.min(c.max, Math.max(c.min, v));
  const schedule = () => { if (running) return; clearTimeout(timer); timer = setTimeout(run, 300); };
  const fmt = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
  const head = (t) => { const b = document.createElement("div"); b.textContent = t; b.style.cssText = "font-weight:700;margin:14px 0 4px"; panel.append(b); return b; };
  const advHead = (t) => { const b = head(t); refreshers.push(() => (b.style.display = advanced ? "" : "none")); };
  const btn = (label, fn) => Object.assign(document.createElement("button"), { textContent: label, onclick: fn });

  // ---------- panel ----------
  const advL = document.createElement("label"), advC = Object.assign(document.createElement("input"), { type: "checkbox" });
  advC.onchange = () => {
    advanced = advC.checked;
    if (!advanced) { S.h = clamp(S.h, tc.voxelSize); S.band = clamp(S.band, tc.designSpace); Object.assign(S, ADV); }
    sync(); schedule();
  };
  advL.append(advC, " Advanced mode (type any value)"); panel.append(advL);

  head("Tool start surface");
  const sel = document.createElement("select");
  tc.toolStartConnection.options.forEach((o) => sel.add(new Option(o.label, o.id)));
  sel.onchange = () => { S.conn = sel.value; schedule(); };
  panel.append(sel);

  head("Tool end faces");
  const count = document.createElement("div"), hint = document.createElement("div"); hint.className = "rec";
  hint.textContent = "Click a face of the tool end in the 3D view to connect to it. Click again to unselect.";
  panel.append(count, hint, btn("Clear faces", () => { picked.clear(); updateHighlight(); schedule(); }));

  function numRow(label, cfg, key, hidden = () => false) {
    const d = document.createElement("div"); d.className = "row";
    const l = Object.assign(document.createElement("label"), { textContent: label });
    const r = Object.assign(document.createElement("input"), { type: "range", min: cfg.min, max: cfg.max, step: cfg.step });
    const n = Object.assign(document.createElement("input"), { type: "number", step: cfg.step });
    const note = document.createElement("div"); note.className = "rec";
    const rec = cfg.recommendedRange; note.textContent = (rec ? `recommended ${rec[0]} to ${rec[1]}. ` : "") + (cfg.note ?? "");
    r.oninput = () => { S[key] = +r.value; sync(); }; r.onchange = schedule;
    n.onchange = () => { let v = +n.value; if (n.value === "" || isNaN(v)) return; if (!advanced) v = clamp(v, cfg); S[key] = v; sync(); schedule(); };
    d.append(l, r, n, note); panel.append(d);
    refreshers.push(() => { r.value = n.value = S[key]; d.style.display = hidden() ? "none" : ""; n.className = rec ? (S[key] >= rec[0] && S[key] <= rec[1] ? "ok" : "warn") : ""; });
  }
  head("Voxels");
  numRow("Voxel size (mm)", tc.voxelSize, "h");
  numRow("Design space size", tc.designSpace, "band");
  numRow("Max analysis voxels", tc.analysisVoxelBudget, "budget", () => !advanced);
  head("Design");
  const qRow = document.createElement("div"); qRow.className = "row"; qRow.innerHTML = "<label>Quality (how long it takes)</label>";
  const qSel = document.createElement("select"); tc.quality.options.forEach((o) => qSel.add(new Option(o.label, o.id)));
  qSel.onchange = () => { const o = tc.quality.options.find((x) => x.id === qSel.value); S.budget = o.budget; S.iters = o.iters; sync(); schedule(); };
  qRow.append(qSel); panel.append(qRow);
  refreshers.push(() => { const o = tc.quality.options.find((x) => x.budget === S.budget && x.iters === S.iters); if (o) qSel.value = o.id; });
  numRow("Material: light ↔ strong", tc.volumeFraction, "vf");
  numRow("Filter radius (voxels)", tc.filterRadius, "rmin", () => !advanced);
  numRow("Max steps", tc.maxIterations, "iters", () => !advanced);
  advHead("Load (one case)");
  numRow("Payload mass (kg)", tc.payloadMassKg, "mass", () => !advanced);
  numRow("Acceleration factor", tc.accelFactor, "accel", () => !advanced);
  const gRow = document.createElement("div"); gRow.className = "row"; gRow.innerHTML = "<label>Gravity direction in the model</label>";
  const gSel = document.createElement("select"); tc.gravityDirection.options.forEach((o) => gSel.add(new Option(o, o))); gSel.onchange = () => (S.gdir = gSel.value);
  gRow.append(gSel); panel.append(gRow);
  numRow("Extra force X (N)", tc.extraForceN, "fx", () => !advanced);
  numRow("Extra force Y (N)", tc.extraForceN, "fy", () => !advanced);
  numRow("Extra force Z (N)", tc.extraForceN, "fz", () => !advanced);

  const info = document.createElement("div"); info.style.cssText = "font-size:12px;margin:10px 0;line-height:1.5"; panel.append(info);
  const setInfo = (cls, html) => { info.className = cls; info.innerHTML = html; };

  head("Generate");
  const typ = document.createElement("div"); typ.style.cssText = "font-size:12px;margin-bottom:6px"; panel.append(typ);
  const bGo = btn("Generate design", () => generate()), bStop = btn("Stop", () => worker?.postMessage({ type: "stop" }));
  bGo.disabled = true; bStop.disabled = true;
  const bar = Object.assign(document.createElement("progress"), { max: 1, value: 0 }); bar.style.cssText = "width:100%;margin-top:6px";
  const prog = document.createElement("div"); prog.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px";
  panel.append(bGo, bStop, bar, prog);

  const selfBox = document.createElement("div"), selfOut = document.createElement("div"); selfOut.style.cssText = "font-size:12px;line-height:1.5;margin-top:4px";
  selfBox.append(btn("Run solver self-test", () => { selfOut.textContent = "Running…"; ensureWorker().postMessage({ type: "selftest" }); }), selfOut); panel.append(selfBox);
  refreshers.push(() => { count.textContent = `${picked.size} face(s) selected`; sel.value = S.conn; gSel.value = S.gdir; gRow.style.display = advanced ? "" : "none"; advC.checked = advanced; selfBox.style.display = advanced ? "" : "none"; });

  function setLock(on) {
    running = on; panel.querySelectorAll("input,select,button").forEach((x) => (x.disabled = on));
    bStop.disabled = !on; if (!on) { bGo.disabled = !lastStats; sync(); }
  }

  // ---------- face picking on the tool end ----------
  const hlMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener("pointerup", (e) => {
    if (!active || running || e.button !== 0 || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    syncPart(); if (!curPart) return;
    const { mesh, fg, k } = faceInfo(curPart);
    if (!fg.length) return setInfo("bad", "✖ This part has no face data. Re-add it in step 2.");
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    curPart.updateMatrixWorld(true); ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObject(mesh, false)[0]; if (!hit) return;
    const t3 = hit.faceIndex * 3, fi = fg.findIndex((g) => t3 >= (g.start / k) * 3 && t3 < ((g.start + g.count) / k) * 3);
    if (fi < 0) return;
    picked.has(fi) ? picked.delete(fi) : picked.add(fi);
    updateHighlight(); sync(); schedule();
  });
  function faceInfo(part) { // replicad gives face ranges in index units; k also accepts triangle units
    const mesh = part.children[0], fg = part.userData.fg || [], nTri = mesh.geometry.index.count / 3;
    return { mesh, fg, k: fg.reduce((m, g) => Math.max(m, g.start + g.count), 0) > nTri ? 3 : 1 };
  }
  function syncPart() { const p = toolEnd.getPart(); if (p === curPart) return; clearHl(); picked.clear(); curPart = p; sync(); }
  function clearHl() { if (hl) { hl.parent?.remove(hl); hl.geometry.dispose(); hl = null; } }
  function updateHighlight() {
    clearHl(); if (!curPart || !picked.size) return;
    const { mesh, fg, k } = faceInfo(curPart), src = mesh.geometry.index.array, idx = [];
    picked.forEach((fi) => { const g = fg[fi], a = (g.start / k) * 3, b = a + (g.count / k) * 3; for (let i = a; i < b; i++) idx.push(src[i]); });
    const bg = new THREE.BufferGeometry(); bg.setAttribute("position", mesh.geometry.getAttribute("position")); bg.setIndex(idx);
    hl = new THREE.Mesh(bg, hlMat); curPart.add(hl);
  }
  function trisOf(mesh, ranges) { // world-space triangles (9 numbers each); ranges = [[firstIndex, lastIndex+1], ...] or null for all
    const pos = mesh.geometry.getAttribute("position"), idx = mesh.geometry.index.array, v = new THREE.Vector3(), out = [];
    for (const [a, b] of ranges ?? [[0, idx.length]]) for (let i = a; i < b; i++) { v.fromBufferAttribute(pos, idx[i]).applyMatrix4(mesh.matrixWorld); out.push(v.x, v.y, v.z); }
    return Float32Array.from(out);
  }
  function endTris(all) {
    curPart.updateMatrixWorld(true);
    const { mesh, fg, k } = faceInfo(curPart);
    return trisOf(mesh, all ? null : [...picked].map((fi) => [(fg[fi].start / k) * 3, (fg[fi].start / k) * 3 + (fg[fi].count / k) * 3]));
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
  const meshOf = (x, mat) => {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(x.p, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(x.n, 3)); bg.setIndex(new THREE.BufferAttribute(x.i, 1));
    const m = new THREE.Mesh(bg, mat); m.visible = active; scene.add(m); return m;
  };
  function clearPrev() { prev.forEach((m) => { scene.remove(m); m.geometry.dispose(); }); prev = []; }
  function clearResult() { if (result) { scene.remove(result); result.geometry.dispose(); result = null; } }
  function setPrev(d, s) { clearPrev(); clearResult(); prev = [meshOf(d, domMat), meshOf(s, srcMat)]; }
  const showResult = (d) => { clearResult(); result = meshOf(d, resMat); };

  function showEstimate() {
    if (!lastStats) return;
    const s = lastStats, e = tc.estimate;
    const min = secPerElem == null ? null : (s.count * e.cgIterationsPerStep * S.iters * secPerElem * e.overheadFactor) / 60;
    const cls = min == null ? "" : min < e.greenBelowMinutes ? "ok" : min < e.yellowBelowMinutes ? "warn" : "bad";
    const time = min == null ? "measuring this computer…" : `about ${min < 1 ? "under 1" : min.toFixed(min < 10 ? 1 : 0)} min (rough estimate)`;
    setInfo("", [
      `Gap between the surfaces: ${s.L.toFixed(1)} mm`,
      `Design voxels: ${s.count.toLocaleString()} (grid ${s.dim.join(" × ")})`,
      `Analysis voxel: ${s.h.toFixed(2)} mm` + (s.h > S.h * 1.001 ? ` (coarser than your ${S.h} mm so the design stays fast)` : ""),
      `<span class="${cls}">Estimated design time: ${time}</span>`,
      cls === "bad" ? `<span class="bad">⚠ This will be slow. Try smaller faces, a smaller design space or a larger voxel size.</span>` : "",
      s.overBudget ? `<span class="warn">⚠ Could not get under the voxel limit. Reduce the design space.</span>` : "",
    ].filter(Boolean).join("<br>"));
    typ.textContent = min == null ? "" : `A design typically takes about ${min < 1 ? "under 1" : min.toFixed(min < 10 ? 1 : 0)} min on this computer. It WILL be slow: leave this tab open.`;
  }
  function onMsg(e) {
    const m = e.data;
    if (m.type === "bench") { secPerElem = m.secPerElem; return showEstimate(); }
    if (m.type === "selftest") { selfOut.innerHTML = m.results.map((r) => `<div class="${r.ok === null ? "" : r.ok ? "ok" : "bad"}">${r.ok === null ? "ℹ" : r.ok ? "✔" : "✖"} ${r.text}</div>`).join(""); return; }
    if (m.type === "progress") {
      if (m.id !== optId) return;
      bar.value = m.it / m.maxIter;
      const per = m.elapsed / m.it;
      prog.textContent = `Step ${m.it}/${m.maxIter} · ${(m.c0 / m.c).toFixed(1)}× stiffer than the start · material ${(m.vol * 100).toFixed(0)}% · ${fmt(m.elapsed)} elapsed, about ${fmt(per * (m.maxIter - m.it))} left at most · solver ${m.cg} iterations`;
      if (m.mesh) showResult(m.mesh);
      return;
    }
    if (m.type === "done") {
      if (m.id !== optId) return;
      setLock(false);
      if (!m.ok) { prev.forEach((x) => (x.visible = active)); prog.innerHTML = `<span class="bad">✖ ${m.error}</span>`; return; }
      showResult(m.mesh); bar.value = m.stopped ? bar.value : 1;
      prog.innerHTML = `<span class="ok">${m.stopped ? "Stopped" : m.converged ? "Finished (stopped changing)" : "Finished (step limit)"} after ${m.it} steps in ${fmt(m.elapsed)}: ${(m.c0 / m.c).toFixed(1)}× stiffer than the start, material ${(m.vol * 100).toFixed(0)}% of the design space.</span>`;
      return;
    }
    if (m.id !== reqId) return; // design space result
    if (!m.ok) { lastStats = null; bGo.disabled = true; clearPrev(); return setInfo("bad", "✖ " + m.error); }
    lastStats = m.stats; bGo.disabled = false; setPrev(m.dom, m.src); showEstimate();
  }
  function ensureWorker() {
    if (!worker) { worker = new Worker(new URL("./voxelWorker.js", import.meta.url), { type: "module" }); worker.onmessage = onMsg; worker.postMessage({ type: "bench" }); }
    return worker;
  }
  function run() {
    syncPart(); const st = getStart();
    if (!st) return setInfo("warn", "Tool start is not ready yet.");
    if (!curPart) { bGo.disabled = true; return setInfo("warn", "Add a part in step 2 (Tool end) first."); }
    if (!picked.size) { lastStats = null; bGo.disabled = true; clearPrev(); clearResult(); return setInfo("warn", "Click one or more faces of the tool end to choose where the connector attaches. They turn green."); }
    ensureWorker(); bGo.disabled = true;
    const d = st.dims, R = S.conn === "partial" ? (d.spigotOuter ? d.spigotOuter / 2 : d.centreHole / 2 + d.thickness) : null;
    const a = startTris(st, false), b = endTris(false), sa = startTris(st, true), ea = endTris(true);
    setInfo("", "Computing design space…");
    worker.postMessage({ type: "domain", id: ++reqId, h: S.h, band: S.band, budget: S.budget, maxCells: tc.maxGridCells, R, startTris: a, endTris: b, startAll: sa, endAll: ea }, [a.buffer, b.buffer, sa.buffer, ea.buffer]);
  }
  function generate() {
    if (!lastStats || !worker) return;
    clearResult(); prev.forEach((x) => (x.visible = false));
    setLock(true); bar.value = 0; tStart = performance.now(); prog.textContent = "Starting… the first step is the slowest.";
    worker.postMessage({ type: "optimize", id: ++optId, vf: S.vf, rmin: S.rmin, maxIter: S.iters, mass: S.mass, accel: S.accel, gdir: S.gdir, extra: [S.fx, S.fy, S.fz] });
  }

  document.addEventListener("stage", (e) => {
    active = e.detail === "C"; panel.style.display = active ? "" : "none";
    prev.forEach((m) => (m.visible = active && !result)); if (result) result.visible = active;
    if (active && !running) { sync(); run(); }
  });
  sync();
}