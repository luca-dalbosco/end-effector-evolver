// Talking to the stage 3 worker (voxelWorker.js): requests, their reply handlers, the time estimate and the panel lock.
import tc from "../../data/toolConnect.json";
import { esc } from "../ui.js";
import { rpc, serial } from "../rpc.js";
import { solidCentroid } from "../geom/voxelize.js";
import { solveCheck } from "../geom/solveCheck.js";
import { store } from "../store.js";

export function initRun(C) {
  const { S, list, getStart } = C, ui = C.ui;
  let vw = null, sendDomain = null, sendBridge = null, reqId = 0, gid = 0, secPerElem = null, predGen = null, predRef = null;
  C.runSig = null; // input signature of the last design space (see inputSig)
  const fmt = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
  const minutes = (min) => `about ${min < 1 ? "under 1" : min.toFixed(min < 10 ? 1 : 0)} min`;
  const rate = (min) => { const e = tc.estimate; return min == null ? "" : min < e.greenBelowMinutes ? "ok" : min < e.yellowBelowMinutes ? "warn" : "bad"; };
  const bad = (out, m) => (out.innerHTML = `<span class="bad">✖ ${esc(m.error)}</span>`);
  // a failed solve (NaN, negative or absurd numbers): the warning shown in the panel, and the sag is not shown
  const trouble = (m) => solveCheck(m, tc.maxSagMm.default), warnHtml = (t) => `<div class="bad" style="margin-top:4px">⚠ ${esc(t)}</div>`;

  // time estimate = measured matrix speed × work × a factor; the factor is learned from the last finished run on this computer
  const calib = { gen: 1, ref: 1 };
  Object.assign(calib, store.json("connCalib", {}));
  const learn = (key, actualMs, predMs) => { if (!(predMs > 0)) return; calib[key] = Math.min(20, Math.max(0.2, actualMs / predMs)); store.set("connCalib", JSON.stringify(calib)); };
  const refWork = (count, its) => count * (tc.estimate.cgIterationsPerStep * its + tc.solver.firstStep.maxCgIterations) * tc.refine.overheadFactor; // × secPerElem × 1000 = ms before learning

  C.setInfo = (cls, html) => { ui.info.className = cls; ui.info.innerHTML = html; };
  C.setPhase = (p) => { // see C.phase in index.js
    const on = p !== "idle"; C.phase = p; C.panel.querySelectorAll("input,select,button").forEach((x) => (x.disabled = on));
    ui.bStop.disabled = !on; if (!on) { ui.bGo.disabled = !C.lastStats; C.sync(); }
  };
  function showEstimate() {
    if (!C.lastStats) return;
    const s = C.lastStats, e = tc.estimate;
    const min = secPerElem == null ? null : (s.count * e.cgIterationsPerStep * S.iters * secPerElem * e.overheadFactor * calib.gen) / 60, cls = rate(min);
    C.setInfo("", [
      `Gap between the surfaces: ${s.L.toFixed(1)} mm`,
      `Design voxels: ${s.count.toLocaleString()} (grid ${s.dim.join(" × ")})`,
      `Analysis voxel: ${s.h.toFixed(2)} mm (set by the voxel limit; use Refine for a finer result)`,
      `<span class="${cls}">Estimated design time: ${min == null ? "measuring this computer…" : `${minutes(min)} (rough estimate)`}</span>`,
      cls === "bad" ? `<span class="bad">⚠ This will be slow. Try smaller faces, a smaller design space or a larger voxel size.</span>` : "",
      C.avoid.length || s.nAvoided ? `<span class="${s.avoidHitsSrc ? "warn" : ""}">Avoided: ${s.nAvoided.toLocaleString()} voxels taken out of the design space (red)</span>` + (s.avoidHitsSrc ? "<br>⚠ An avoided zone touches a connect surface. The surface voxels were kept." : "") : "",
      s.overBudget ? `<span class="warn">⚠ Could not get under the voxel limit. Reduce the design space.</span>` : "",
    ].filter(Boolean).join("<br>"));
    ui.typ.textContent = min == null ? "" : `A design typically takes ${minutes(min)} on this computer. It WILL be slow: leave this tab open.`;
  }

  // ---------- worker replies (each request names its own reply handler) ----------
  function onRefine(m) { // "refine": voxel info, then progress, then the result
    if (m.refineInfo) {
      const s = m.stats, min = secPerElem == null ? null : (refWork(s.count, tc.refine.maxIterations.default) * secPerElem * calib.ref) / 60;
      predRef = { count: s.count };
      ui.refOut.innerHTML = [
        `Refined voxel: ${s.h.toFixed(2)} mm` + (s.h > S.h * 1.001 ? ` (coarser than your ${S.h} mm so it fits the voxel budget)` : ""),
        `Voxels: ${s.count.toLocaleString()} (grid ${s.dim.join(" × ")})`,
        min == null ? "" : `<span class="${rate(min)}">Estimated time: ${minutes(min)} (at most, rough)${calib.ref === 1 ? ". It gets more accurate after your first refine." : ""}</span>`,
        s.overBudget ? `<span class="warn">⚠ Could not get under the voxel budget. This may be slow.</span>` : "",
      ].filter(Boolean).join("<br>");
      return;
    }
    if (m.progress) {
      ui.rfBar.value = m.it / m.maxIter;
      ui.refOut.querySelector(".rprog")?.remove();
      const p = Object.assign(document.createElement("div"), { className: "rprog" }); p.style.marginTop = "4px";
      p.textContent = `Step ${m.it}/${m.maxIter} · ${(m.c0 / m.c).toFixed(2)}× the stiffness of the coarse design · material ${((m.vol / m.cap) * 100).toFixed(0)}% of the coarse volume · ${fmt(m.elapsed)} elapsed, about ${fmt((m.elapsed / m.it) * (m.maxIter - m.it))} left at most`;
      ui.refOut.append(p);
      const tr = trouble(m); if (tr) p.innerHTML = warnHtml(tr) + esc(p.textContent);
      if (m.mesh) C.keep(() => C.showResult(m.mesh));
      return;
    }
    C.setPhase("idle");
    if (!m.ok) { bad(ui.refOut, m); if (C.coarseGhost && !C.result) { C.result = C.coarseGhost; C.result.material = C.mats.res; C.coarseGhost = null; } return; }
    if (!m.stopped && predRef && secPerElem != null) learn("ref", m.elapsed, refWork(predRef.count, m.it) * secPerElem * 1000);
    const tr = trouble(m), sag = tr ? null : m.sag;
    C.showResult(m.mesh); C.canClear = true; ui.rfBar.value = m.stopped ? ui.rfBar.value : 1; if (!m.stopped) C.storeGen(S.ref, m.mesh, m.stats, sag); C.sync();
    const t = m.stats; C.vol = t.volCm3; C.over = t.overhang; C.sag = sag; C.showSummary();
    ui.refOut.innerHTML = `<span class="${t.connected ? "ok" : "bad"}">${t.connected ? "✔" : "⚠ The robot side and the tool are no longer connected."} Refine ${m.stopped ? "stopped" : "finished"} after ${m.it} steps in ${fmt(m.elapsed)}. Voxel ${m.h.toFixed(2)} mm (analysis was ${m.hc.toFixed(2)} mm).` + (C.advanced ? `<br>Stiffness: ${(m.c0 / m.c).toFixed(2)}× the coarse design. Material: ${((m.vol / m.cap) * 100).toFixed(0)}% of the coarse volume. ${t.islands.toLocaleString()} loose voxels dropped.` : "") + "</span>" + (tr ? warnHtml(tr) : "");
  }
  const onRestored = (level) => (m) => { // "restore": the worker holds this finished level again, so it can be smoothed
    if (!m.ok) return bad(ui.refOut, m);
    C.clearCoarseGhost(); C.showResult(m.mesh); C.sag = C.gens[level]?.sag ?? null; // the clearance below brings weight and overhangs back, the sag comes from the stored level
    C.canClear = true; C.workerLevel = level; ui.refOut.innerHTML = `<span class="ok">${C.levelName(level)} design.</span>`; C.sync();
    applyClearance(); // reads the weight and overhangs again
  };
  const onBridge = (id) => (m) => {
    if (id !== reqId) return; // the setup changed since
    if (!m.ok) { C.clearResult(); return bad(ui.brOut, m); }
    C.showResult(m.mesh); C.bridged = m.mesh.i.length > 0; C.sync();
    const t = m.stats; C.vol = t.volCm3; C.over = t.overhang; C.sag = null; C.showSummary();
    ui.brOut.innerHTML = `<span class="${t.connected ? "ok" : "bad"}">${t.connected ? "✔ Bridge ready" : "⚠ The keep-outs cut the bridge: the robot side and the tool are not connected"} in ${(t.ms / 1000).toFixed(1)} s.</span>`
      + (t.waistCut ? `<br><span class="warn">Print-ready: waist lowered to ${t.waist.toFixed(0)}% so the walls do not overhang more than 45°.</span>` : "")
      + (C.advanced ? `<br>Voxel ${t.h.toFixed(2)} mm, ${t.tris.toLocaleString()} triangles, ${t.islands.toLocaleString()} loose cells dropped.` : "");
  };
  const onSelftest = (m) => { ui.selfOut.innerHTML = (m.more ? "" : ui.selfOut.innerHTML) + m.results.map((r) => `<div class="${r.ok === null ? "" : r.ok ? "ok" : "bad"}">${r.ok === null ? "ℹ" : r.ok ? "✔" : "✖"} ${esc(r.text)}</div>`).join(""); };
  const onPreview = (id) => (m) => { if (id === gid && m.ok) { C.clearGhost(); if (m.mesh.i.length) C.ghost = C.meshOf(m.mesh, C.mats.ghost); } };
  const onSmoothed = (id, op) => (m) => {
    if (id !== gid) return;
    if (!m.ok) return bad(ui.smOut, m);
    C.keep(() => C.showResult(m.mesh)); C.canClear = true; C.sync();
    const t = m.stats; if (t.volCm3 != null) { C.vol = t.volCm3; C.over = null; C.showSummary(); }
    ui.smOut.innerHTML = m.reset ? `<span class="ok">Back to voxels.</span>`
      : `<span class="${t.connected ? "ok" : "bad"}">${t.connected ? "✔" : "⚠ The robot side and the tool are no longer connected."} ${op === "smoothClear" ? `Cut ${t.cut.toLocaleString()} cells in the zones. ` : ""}${t.islands ? `${t.islands.toLocaleString()} loose cells dropped. ` : ""}Volume ${t.volCm3.toFixed(1)} cm³, ${t.tris.toLocaleString()} triangles.</span>`;
  };
  function onCleared(m) { // "clear": the Clearance step right after a design (phase clearing) or after going back to the Draft
    if (!m.ok) { C.setPhase("idle"); return bad(ui.clrOut, m); }
    const t = m.stats; C.keep(() => C.showResult(m.mesh)); C.canClear = true;
    C.vol = t.volCm3; C.over = t.overhang; C.showSummary();
    ui.clrOut.innerHTML = `<span class="${t.connected ? "ok" : "bad"}">${t.connected ? "✔ Cleared" : "⚠ The robot side and the tool are no longer connected"}: ${t.cut.toLocaleString()} voxels deleted in the zones, ${t.islands.toLocaleString()} loose voxels dropped.</span>`;
    if (C.phase === "clearing") C.storeGen(C.levels[0], m.mesh, t, C.sag); // the Draft is finished
    if (C.busy()) C.setPhase("idle"); else C.sync();
  }
  function onOptimize(m) { // "optimize": progress, then the result, then the Clearance step runs by itself
    if (m.progress) {
      ui.bar.value = m.it / m.maxIter;
      const per = m.elapsed / m.it;
      ui.prog.textContent = `Designing: step ${m.it}/${m.maxIter} · ${fmt(m.elapsed)} elapsed, about ${fmt(per * (m.maxIter - m.it))} left at most` + (C.advanced ? ` · ${(m.c0 / m.c).toFixed(1)}× stiffer than the start · material ${(m.vol * 100).toFixed(0)}% · solver ${m.cg} iterations` : "");
      const tr = trouble(m); if (tr) ui.prog.innerHTML = warnHtml(tr) + esc(ui.prog.textContent);
      if (m.mesh) C.showResult(m.mesh);
      return;
    }
    if (!m.ok) { C.setPhase("idle"); C.prev.forEach((x) => (x.visible = C.active)); return bad(ui.prog, m); }
    const tr = trouble(m);
    C.showResult(m.mesh); C.canClear = true; ui.bar.value = m.stopped ? ui.bar.value : 1; C.sag = tr ? null : m.sag;
    if (!m.stopped && secPerElem != null) learn("gen", m.elapsed, predGen * (m.it / S.iters) * secPerElem * 1000);
    ui.prog.innerHTML = `<span class="ok">Design ${m.stopped ? "stopped" : "finished"} after ${m.it} steps in ${fmt(m.elapsed)}.</span>` + (tr ? warnHtml(tr) : "");
    if (m.stopped) C.setPhase("idle"); else C.phase = "clearing"; // a finished design stays locked until its clearance is back
    ui.clrOut.textContent = "Clearing…"; vw("clear", {}, onCleared); // the voxel result is always cleared
  }
  const onDomain = (id) => (m) => {
    if (id !== reqId) return; // the setup changed since
    if (!m.ok) { C.lastStats = null; ui.bGo.disabled = true; C.clearPrev(); return C.setInfo("bad", "✖ " + esc(m.error)); }
    C.lastStats = m.stats; ui.bGo.disabled = false; C.setPrev(m.dom, m.src, m.avoid); showEstimate(); ghostPreview(); C.sync();
  };

  // ---------- requests ----------
  function ensureWorker() {
    if (!vw) {
      vw = rpc(new Worker(new URL("../voxelWorker.js", import.meta.url), { type: "module" }), "design engine");
      sendDomain = serial(vw, "domain"); sendBridge = serial(vw, "bridge");
      vw("bench", {}, (m) => { secPerElem = m.secPerElem; showEstimate(); });
    }
    return vw;
  }
  function ghostPreview() { if (vw && C.lastStats && !C.busy()) vw("clearPreview", {}, onPreview(++gid)); }
  function applyClearance() { if (!vw || !C.canClear) return; ui.clrOut.textContent = "Clearing…"; vw("clear", {}, onCleared); }
  C.restore = (level) => vw && (vw("restore", { level, draft: level === C.levels[0] }, onRestored(level)), true);
  C.stop = () => { if (C.phase === "clearing") C.phase = "stopping"; vw?.("stop"); }; // a stopped Draft is not kept as a finished level
  C.selftest = () => { ui.selfOut.textContent = "Running…"; ensureWorker()("selftest", {}, onSelftest); };
  C.smooth = (type, data, text) => { if (!vw || !C.canClear) return; ui.smOut.textContent = text; vw(type, data, onSmoothed(++gid, type)); };

  // what the design space depends on: used to keep results when you come back to this tab without changing anything
  const r3 = (v) => Math.round(v * 1000) / 1000;
  C.inputSig = () => JSON.stringify([C.picked.map((p) => p.key), C.avoid.map((a) => [a.key, a.mm]),
    list.items().filter((i) => i.deletable !== false).map((i) => [i.id, i.object.position.toArray().map(r3), [i.object.rotation.x, i.object.rotation.y, i.object.rotation.z].map(r3)]),
    S.band, S.budget, S.print, S.conn, S.bd, S.bl, S.bshape, S.bslot, C.robot.mm, getStart()?.dims]);
  const startR = (d) => (S.conn === "partial" ? (d.spigotOuter ? d.spigotOuter / 2 : d.centreHole / 2 + d.thickness) : null);

  C.run = () => { // after any change: the bridge (Bridge) or the design space (Voxel)
    C.renderAvoid(); const st = getStart();
    if (!st) return C.setInfo("warn", "Robot side is not ready yet.");
    const nothing = (msg) => { C.lastStats = null; ui.bGo.disabled = true; C.cog = null; C.drawArrow(); C.clearPrev(); C.clearResult(); C.setInfo("warn", msg); };
    if (!list.items().some((i) => i.deletable !== false)) return nothing("Add a part in step 2 (Tool) first.");
    if (!C.picked.length) return nothing("Pick \"Connect face\" and click one or more faces of the tool objects. They turn green.");
    C.cog = solidCentroid(C.endTris(true)); C.drawArrow();
    ensureWorker(); C.drawRobot();
    if (S.method === "bridge") {
      C.clearPrev(); C.lastStats = null; C.setInfo("", "");
      const b = C.endTris(false), ea = C.endTris(true), av = C.avoidData(), ko = C.keepOut();
      ui.brOut.textContent = "Building the bridge…";
      return sendBridge({ h: S.bh, waist: S.waist, maxCells: tc.maxGridCells, R: startR(st.dims), endTris: b, endAll: ea, avoid: av.items, keepOut: ko }, onBridge(++reqId), [b.buffer, ea.buffer, ...av.tr]);
    }
    ui.bGo.disabled = true; C.runSig = C.inputSig();
    const a = C.startTris(st, false), b = C.endTris(false), sa = C.startTris(st, true), ea = C.endTris(true), av = C.avoidData(), ko = C.keepOut();
    C.setInfo("", "Computing design space…");
    sendDomain({ h: tc.voxelSize.min, band: S.band, budget: S.budget, maxCells: tc.maxGridCells, R: startR(st.dims), startTris: a, endTris: b, startAll: sa, endAll: ea, avoid: av.items, keepOut: ko }, onDomain(++reqId), [a.buffer, b.buffer, sa.buffer, ea.buffer, ...av.tr]);
  };
  C.generate = () => { // Draft: design, then clearance
    if (!C.lastStats || !vw) return;
    ui.refOut.textContent = ""; C.clearCoarseGhost(); C.reached = {}; C.gens = {}; C.workerLevel = null; C.levelWarn = "";
    predGen = C.lastStats.count * tc.estimate.cgIterationsPerStep * S.iters * tc.estimate.overheadFactor; // × secPerElem × 1000 = ms before learning
    C.clearResult(); C.prev.forEach((x) => (x.visible = false));
    C.setPhase("designing"); ui.bar.value = 0; ui.prog.textContent = "Starting… the first step is the slowest.";
    vw("optimize", { vf: S.vf, rmin: S.rmin, maxIter: S.iters, mass: S.mass, accel: S.accel, gdir: S.gdir, extra: [S.fx, S.fy, S.fz] }, onOptimize);
  };
  C.refine = () => { // Normal or Fine: Refine step on the Draft design
    if (!vw || !C.canRefine()) return;
    const d = (k) => tc.refine[k].default;
    if (C.result) { C.clearCoarseGhost(); C.coarseGhost = C.result; C.coarseGhost.material = C.mats.coarse; C.result = null; } // the coarse result stays visible as a transparent ghost
    C.setPhase("refining"); ui.rfBar.value = 0; ui.refOut.textContent = "Preparing the finer grid…";
    vw("refine", { level: S.ref, h: S.h, budget: d("voxelBudget"), maxCells: tc.maxGridCells, bandVoxels: d("bandVoxels"), rmin: S.rmin, maxIter: d("maxIterations"), mass: S.mass, accel: S.accel, gdir: S.gdir, extra: [S.fx, S.fy, S.fz], shrink: { tol: d("stiffnessTolerance"), step: d("shrinkStep"), minFrac: d("minVolumeFraction") } }, onRefine);
  };
}
