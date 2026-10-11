// Stage C (part 1): choose connect surfaces, preview the voxel design space, estimate the time.
import * as THREE from "three";
import tc from "../data/toolConnect.json";

export function initToolConnect({ scene, cam, renderer, $, toolEnd, getStart }) {
  const dom = renderer.domElement;
  const S = { conn: tc.toolStartConnection.default, h: tc.voxelSize.default, band: tc.designSpace.default, budget: tc.analysisVoxelBudget.default };
  let advanced = false, active = false, worker = null, reqId = 0, timer = null, secPerElem = null, lastStats = null;
  let curPart = null, hl = null, prev = [];
  const picked = new Set();
  const panel = document.createElement("div"); panel.style.display = "none"; $("exportA").after(panel);
  const refreshers = [], sync = () => refreshers.forEach((f) => f());
  const clamp = (v, c) => Math.min(c.max, Math.max(c.min, v));
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 300); };
  const head = (t) => { const b = document.createElement("div"); b.textContent = t; b.style.cssText = "font-weight:700;margin:14px 0 4px"; panel.append(b); };

  // ---------- panel ----------
  const advL = document.createElement("label"), advC = Object.assign(document.createElement("input"), { type: "checkbox" });
  advC.onchange = () => {
    advanced = advC.checked;
    if (!advanced) { S.h = clamp(S.h, tc.voxelSize); S.band = clamp(S.band, tc.designSpace); S.budget = tc.analysisVoxelBudget.default; }
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
  const clear = Object.assign(document.createElement("button"), { textContent: "Clear faces" });
  clear.onclick = () => { picked.clear(); updateHighlight(); schedule(); };
  panel.append(count, hint, clear);

  head("Voxels");
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
    refreshers.push(() => { r.value = n.value = S[key]; d.style.display = hidden() ? "none" : ""; n.className = rec && S[key] >= rec[0] && S[key] <= rec[1] ? "ok" : "warn"; });
  }
  numRow("Voxel size (mm)", tc.voxelSize, "h");
  numRow("Design space size", tc.designSpace, "band");
  numRow("Max analysis voxels", tc.analysisVoxelBudget, "budget", () => !advanced);
  const info = document.createElement("div"); info.style.cssText = "font-size:12px;margin:10px 0;line-height:1.5"; panel.append(info);
  const setInfo = (cls, html) => { info.className = cls; info.innerHTML = html; };
  refreshers.push(() => { count.textContent = `${picked.size} face(s) selected`; sel.value = S.conn; advC.checked = advanced; });

  // ---------- face picking on the tool end ----------
  const hlMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener("pointerup", (e) => {
    if (!active || e.button !== 0 || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
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
  // replicad gives face ranges in index units; the k factor also accepts triangle units.
  function faceInfo(part) {
    const mesh = part.children[0], fg = part.userData.fg || [], nTri = mesh.geometry.index.count / 3;
    const end = fg.reduce((m, g) => Math.max(m, g.start + g.count), 0);
    return { mesh, fg, k: end > nTri ? 3 : 1 };
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
  function endTris() {
    curPart.updateMatrixWorld(true);
    const { mesh, fg, k } = faceInfo(curPart), pos = mesh.geometry.getAttribute("position"), idx = mesh.geometry.index.array, v = new THREE.Vector3(), out = [];
    picked.forEach((fi) => { const g = fg[fi], a = (g.start / k) * 3, b = a + (g.count / k) * 3; for (let i = a; i < b; i++) { v.fromBufferAttribute(pos, idx[i]).applyMatrix4(mesh.matrixWorld); out.push(v.x, v.y, v.z); } });
    return Float32Array.from(out);
  }
  // Top face of the tool start (the face away from the robot, z = plate thickness).
  function startTris(info) {
    const { v, n, t } = info.mesh, z0 = info.dims.thickness, out = [];
    for (let i = 0; i < t.length; i += 3) {
      const q = [t[i], t[i + 1], t[i + 2]];
      if (n[q[0] * 3 + 2] < 0.9 || q.some((x) => Math.abs(v[x * 3 + 2] - z0) > 1e-3)) continue;
      for (const x of q) out.push(v[x * 3], v[x * 3 + 1], v[x * 3 + 2]);
    }
    return Float32Array.from(out);
  }

  // ---------- design space preview ----------
  const domMat = new THREE.MeshStandardMaterial({ color: 0x4a7fb5, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const srcMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, side: THREE.DoubleSide });
  function clearPrev() { prev.forEach((m) => { scene.remove(m); m.geometry.dispose(); }); prev = []; }
  function setPrev(d, s) {
    clearPrev();
    for (const [x, mat] of [[d, domMat], [s, srcMat]]) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.BufferAttribute(x.p, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(x.n, 3)); bg.setIndex(new THREE.BufferAttribute(x.i, 1));
      const m = new THREE.Mesh(bg, mat); m.visible = active; scene.add(m); prev.push(m);
    }
  }
  function showEstimate() {
    if (!lastStats) return;
    const s = lastStats, e = tc.estimate;
    const min = secPerElem == null ? null : (s.count * e.cgIterationsPerStep * e.optimizationSteps * secPerElem * e.overheadFactor) / 60;
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
  }
  function onMsg(e) {
    const m = e.data;
    if (m.type === "bench") { secPerElem = m.secPerElem; return showEstimate(); }
    if (m.id !== reqId) return;
    if (!m.ok) { lastStats = null; clearPrev(); return setInfo("bad", "✖ " + m.error); }
    lastStats = m.stats; setPrev(m.dom, m.src); showEstimate();
  }
  function run() {
    syncPart(); const st = getStart();
    if (!st) return setInfo("warn", "Tool start is not ready yet.");
    if (!curPart) return setInfo("warn", "Add a part in step 2 (Tool end) first.");
    if (!picked.size) { lastStats = null; clearPrev(); return setInfo("warn", "Click one or more faces of the tool end to choose where the connector attaches. They turn green."); }
    if (!worker) {
      worker = new Worker(new URL("./voxelWorker.js", import.meta.url), { type: "module" });
      worker.onmessage = onMsg; worker.postMessage({ type: "bench" });
    }
    const d = st.dims, R = S.conn === "partial" ? (d.spigotOuter ? d.spigotOuter / 2 : d.centreHole / 2 + d.thickness) : null;
    const a = startTris(st), b = endTris();
    setInfo("", "Computing design space…");
    worker.postMessage({ type: "domain", id: ++reqId, h: S.h, band: S.band, budget: S.budget, maxCells: tc.maxGridCells, R, startTris: a, endTris: b }, [a.buffer, b.buffer]);
  }

  document.addEventListener("stage", (e) => {
    active = e.detail === "C"; panel.style.display = active ? "" : "none";
    prev.forEach((m) => (m.visible = active));
    if (active) { sync(); run(); }
  });
  sync();
}