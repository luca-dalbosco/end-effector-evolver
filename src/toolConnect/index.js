// Stage C (tab 3 Preparation and tab 4 Generation): connect faces, keep-outs, Bridge or Voxel design with live preview.
// All parts share one context C: the settings (C.S), the run and result state, and the functions each part adds.
// C.sync() runs every refresher, which redraws the panel from that state.
//   picking.js   connect / avoid faces and objects, triangles for the worker
//   clearance.js Flange Clearance and Bolt Clearance
//   panel.js     Generation section (levels.js: Draft | Normal | Fine)
//   preview.js   3D meshes, load arrow, legend, weight readout
//   run.js       worker requests and replies
import tc from "../../data/toolConnect.json";
import { section, toggle } from "../ui.js";
import { clamp } from "./rows.js";
import { initPicking } from "./picking.js";
import { initClearance } from "./clearance.js";
import { initPanel } from "./panel.js";
import { initPreview } from "./preview.js";
import { initRun } from "./run.js";

export function initToolConnect({ scene, cam, renderer, $, getStart, list }) {
  // Advanced-only settings: back to these defaults when Advanced is switched off
  const ADV = { budget: tc.analysisVoxelBudget.default, rmin: tc.filterRadius.default, iters: tc.maxIterations.default, mass: tc.payloadMassKg.default, accel: tc.accelFactor.default, gdir: tc.gravityDirection.default, fx: 0, fy: 0, fz: 0, sp: tc.smooth.passes.default, bh: tc.bridge.voxelSizeMm.default };
  const S = { conn: tc.toolStartConnection.default, h: tc.refinement.draftVoxelMm, vt: tc.voxelTarget.default, band: tc.designSpace.default, ref: tc.refinement.default, vf: tc.volumeFraction.default, print: tc.printReady.default, bd: tc.bolt.diameterAdjustMm.default, bl: tc.bolt.lengthAdjustMm.default, bshape: tc.bolt.shape.default, bslot: tc.bolt.slotLengthMm.default, method: tc.method.default, waist: tc.bridge.waistPercent.default, gapObj: tc.avoid.objectGrowMm.default, gapFace: tc.avoid.faceExtrudeMm.default, ...ADV };
  const C = {
    scene, cam, dom: renderer.domElement, list, getStart, S,
    advanced: false, active: false, // active = tab 3 or 4 is shown
    phase: "idle", // what the worker is doing for the panel: idle | designing | clearing (right after a design) | stopping (Stop during that clearing) | refining. Not idle = panel locked (run.js setPhase)
    lastStats: null, // design space of the last Voxel run
    canClear: false, bridged: false, // canClear: a voxel result exists, so Clearance and Smooth can work on it; bridged: a Bridge result exists
    vol: null, sag: null, over: null, cog: null, // readout of the current result; centre of mass of the tool
    refreshers: [],
  };
  C.sync = () => C.refreshers.forEach((f) => f());
  C.busy = () => C.phase !== "idle";
  let timer = null;
  C.schedule = () => { if (C.busy()) return; clearTimeout(timer); timer = setTimeout(() => C.run(), tc.rebuildDelayMs); };

  const panel = (C.panel = document.createElement("div")); panel.style.display = "none"; $("exportA").after(panel);
  const prep = section("Preparation"), gen = section("Generation"); panel.append(prep.box, gen.box);
  initPicking(C, prep.body);
  initClearance(C, prep.body);
  const pr = toggle("Printable without supports (test)", (v) => { S.print = v; C.schedule(); }, "printable"); prep.body.append(pr.el);
  pr.el.style.marginTop = "18px"; // room under Robot Clearance
  C.refreshers.push(() => pr.set(S.print));
  initPanel(C, gen.body);
  initPreview(C);
  initRun(C);

  document.addEventListener("advanced", (e) => {
    if (e.detail.stage !== "C") return;
    C.advanced = e.detail.on;
    if (!C.advanced) { // back inside the Basic ranges
      for (const [k, c] of [["vf", tc.volumeFraction], ["band", tc.designSpace], ["vt", tc.voxelTarget], ["bd", tc.bolt.diameterAdjustMm], ["bl", tc.bolt.lengthAdjustMm], ["bslot", tc.bolt.slotLengthMm], ["waist", tc.bridge.waistPercent], ["gapObj", tc.avoid.objectGrowMm], ["gapFace", tc.avoid.faceExtrudeMm]]) S[k] = clamp(S[k], c);
      Object.assign(S, ADV); C.applyRef(S.ref);
      C.robot.mm = clamp(C.robot.mm, tc.avoid.robotOffsetMm);
      C.drawRobot(); C.renderAvoid();
    }
    C.sync(); C.schedule();
  });
  document.addEventListener("stage", (e) => {
    const was = C.active; C.tab = e.detail; C.active = e.detail === "C" || e.detail === "G"; // C = 3 Preparation, G = 4 Generation
    panel.style.display = C.active ? "" : "none"; prep.box.style.display = e.detail === "C" ? "" : "none"; gen.box.style.display = e.detail === "G" ? "" : "none";
    C.stageVisibility(e.detail);
    if (!C.active) return;
    C.renderAvoid();
    if (!C.busy()) { C.sync(); if (!was && (S.method !== "optimize" || !C.lastStats || C.inputSig() !== C.runSig)) C.run(); }
  });
  C.renderAvoid(); C.sync();
  return { // used by stage D (Export)
    getResult: () => (C.result && !C.busy() && (C.canClear || C.bridged) && C.result.geometry.index ? { p: C.result.geometry.getAttribute("position").array, i: C.result.geometry.index.array } : null),
    isAvoided: C.isAvoided,
    connectedCount: () => C.picked.length,
  };
}
