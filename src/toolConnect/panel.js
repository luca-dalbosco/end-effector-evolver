// Generation section of the stage 3 panel: Bridge | Voxel switch, voxel and load settings, Generate, smoothing, self-test.
// The text outputs are kept in C.ui for the reply handlers (run.js).
import tc from "../../data/toolConnect.json";
import { help, segmented } from "../ui.js";
import { head, btn, textBox, numRow, group } from "./rows.js";
import { initLevels } from "./levels.js";

export function initPanel(C, host) {
  const { S } = C, ui = (C.ui = {});
  const small = "font-size:12px;line-height:1.5;margin-top:4px";
  const meth = segmented([{ id: "bridge", label: "Bridge" }, { id: "optimize", label: "Voxel" }], (id) => {
    S.method = id; ui.refOut.textContent = ""; C.clearCoarseGhost(); C.clearPrev(); C.clearResult(); C.lastStats = null; C.setInfo("", ""); C.sync(); C.run();
  });
  host.append(meth.el);

  // ---------- Voxel: settings ----------
  const fromOpt = host.children.length;
  head(host, "Voxels");
  numRow(C, host, "Design space size", tc.designSpace, "band");
  numRow(C, host, "Max analysis voxels", tc.analysisVoxelBudget, "budget", () => !C.advanced);
  head(host, "Design");
  initLevels(C, host);
  // Material amount (%): slider from volumeFraction, with a weight estimate (design-space volume × amount × PLA density)
  const vfc = tc.volumeFraction, maRow = document.createElement("div"); maRow.className = "row"; maRow.innerHTML = "<label>Material amount (%)</label>"; maRow.firstChild.append(help("materialAmount"));
  const maR = Object.assign(document.createElement("input"), { type: "range", min: vfc.min * 100, max: vfc.max * 100, step: 1 });
  const maN = Object.assign(document.createElement("input"), { type: "number", step: 1 }), maW = document.createElement("div"); maW.className = "rec";
  const setVf = (pct) => { S.vf = Math.round(pct) / 100; C.sync(); };
  maR.oninput = () => setVf(+maR.value);
  maN.onchange = () => { let v = +maN.value; if (maN.value === "" || isNaN(v)) return; if (!C.advanced) v = Math.min(vfc.max * 100, Math.max(vfc.min * 100, v)); setVf(v); };
  maRow.append(maR, maN, maW); host.append(maRow);
  C.refreshers.push(() => {
    const pct = Math.round(S.vf * 100), rec = vfc.recommendedRange, s = C.lastStats;
    maR.value = maN.value = pct; maN.className = S.vf >= rec[0] && S.vf <= rec[1] ? "ok" : "warn";
    maW.textContent = s ? `≈ ${Math.round(s.count * s.h ** 3 / 1000 * S.vf * tc.material.densityGcm3)} g (design space × ${pct}% × ${tc.material.label})` : "Weight estimate appears when a design space is ready.";
  });
  numRow(C, host, "Filter radius (voxels)", tc.filterRadius, "rmin", () => !C.advanced);
  numRow(C, host, "Max steps", tc.maxIterations, "iters", () => !C.advanced);
  head(host, "Load");
  const loadInfo = textBox("font-size:12px;margin-bottom:4px"); host.append(loadInfo);
  numRow(C, host, "Payload mass (kg)", tc.payloadMassKg, "mass", () => !C.advanced, false);
  numRow(C, host, "Acceleration factor", tc.accelFactor, "accel", () => !C.advanced, false);
  const gRow = document.createElement("div"); gRow.className = "row"; gRow.innerHTML = "<label>Load direction in the model</label>";
  const gSel = document.createElement("select"); tc.gravityDirection.options.forEach((o) => gSel.add(new Option(o, o))); gSel.onchange = () => { S.gdir = gSel.value; C.sync(); };
  gRow.append(gSel); host.append(gRow);
  for (const a of ["x", "y", "z"]) numRow(C, host, `Extra force ${a.toUpperCase()} (N)`, tc.extraForceN, "f" + a, () => !C.advanced, false);
  C.refreshers.push(() => {
    gSel.value = S.gdir; gRow.style.display = C.advanced ? "" : "none";
    loadInfo.textContent = `One force on the tool: ${Math.hypot(...C.forceVec()).toFixed(0)} N (${S.mass} kg × ${S.accel} × 9.81` + (S.fx || S.fy || S.fz ? " + extra" : "") + `), the yellow arrow in the 3D view.`;
    C.drawArrow();
  });
  const optA = group(host, fromOpt);
  ui.info = textBox("font-size:12px;margin:10px 0;line-height:1.5"); host.append(ui.info);

  // ---------- Bridge ----------
  const fromBr = host.children.length;
  numRow(C, host, "Waist (% narrower in the middle)", tc.bridge.waistPercent, "waist", undefined, undefined, "bridge");
  numRow(C, host, "Bridge voxel size (mm)", tc.bridge.voxelSizeMm, "bh", () => !C.advanced);
  ui.brOut = textBox(small); host.append(ui.brOut);
  const brG = group(host, fromBr);

  // ---------- Voxel: Generate, smoothing ----------
  const fromOpt2 = host.children.length;
  head(host, "Generate");
  const genNote = document.createElement("div"); genNote.className = "rec";
  genNote.textContent = "Draft: designs the connector and clears the red zones, Flange Clearance and Bolt Clearance (orange ghost = the gap around red items), drops loose pieces. Normal and Fine refine the Draft on a finer voxel.";
  ui.typ = textBox("font-size:12px;margin-bottom:6px"); host.append(genNote, ui.typ);
  ui.bGo = btn("Generate Draft", () => (C.isDraft() ? C.generate() : C.refine())); ui.bStop = btn("Stop", () => C.stop());
  ui.bGo.disabled = true; ui.bStop.disabled = true;
  const progress = () => { const p = Object.assign(document.createElement("progress"), { max: 1, value: 0 }); p.style.cssText = "width:100%;margin-top:6px"; return p; };
  ui.bar = progress(); ui.prog = textBox(small); ui.clrOut = textBox(small);
  const stick = textBox("position:sticky;bottom:0;z-index:3;background:var(--bg);padding:6px 0;border-top:1px solid var(--line)");
  stick.append(ui.bGo, ui.bStop, ui.bar); host.append(stick, ui.prog, ui.clrOut);
  ui.rfBar = progress(); ui.refOut = textBox(small); host.append(ui.rfBar, ui.refOut);
  ui.sumOut = textBox("font-size:13px;line-height:1.6;margin-top:8px;font-weight:600"); host.append(ui.sumOut); // moved under the result of the active method

  head(host, "Smoothing (optional)").append(help("smoothing"));
  const smRow = document.createElement("div"); smRow.className = "row"; smRow.innerHTML = "<label>Smoothing strength</label>";
  const smSel = document.createElement("select"); tc.smooth.strength.options.forEach((o) => smSel.add(new Option(o.label, o.id)));
  smSel.value = tc.smooth.strength.default; smSel.onchange = () => { S.sp = tc.smooth.strength.options.find((o) => o.id === smSel.value).passes; C.sync(); };
  smRow.append(smSel); host.append(smRow);
  numRow(C, host, "Smoothing passes per click", tc.smooth.passes, "sp", () => !C.advanced, false);
  ui.smOut = textBox(small);
  const bSmooth = btn("Smooth", () => C.smooth("smooth", { passes: S.sp }, "Smoothing…"));
  const bUnsmooth = btn("Reset to voxels", () => C.smooth("smoothReset", {}, "Resetting…"));
  host.append(bSmooth, bUnsmooth, ui.smOut);
  head(host, "Re-cut clearances").append(help("reCut"));
  const bCut = btn("Cut clearance", () => C.smooth("smoothClear", {}, "Cutting…"));
  host.append(bCut);
  const optB = group(host, fromOpt2);

  const selfBox = document.createElement("div"); ui.selfOut = textBox(small);
  selfBox.append(btn("Run solver self-test", () => C.selftest()), ui.selfOut); host.append(selfBox);

  C.refreshers.push(() => {
    meth.set(S.method); optA.style.display = optB.style.display = S.method === "optimize" ? "" : "none"; brG.style.display = S.method === "bridge" ? "" : "none";
    const at = S.method === "bridge" ? ui.brOut : ui.refOut; if (ui.sumOut.previousSibling !== at) at.after(ui.sumOut); // weight readout under the active method's result
    bSmooth.disabled = bCut.disabled = bUnsmooth.disabled = C.busy() || !C.canClear || C.workerLevel !== S.ref;
    const o = tc.smooth.strength.options.find((x) => x.passes === S.sp); if (o) smSel.value = o.id;
    selfBox.style.display = C.advanced ? "" : "none";
  });
}
