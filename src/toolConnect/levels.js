// Refinement ladder (Voxel method). Draft = design + clearance. Normal and Fine = Refine step on the Draft design at a finer voxel
// (Fine = voxel target, Normal = halfway). A level unlocks when the one before it has finished; finished levels are kept.
import tc from "../../data/toolConnect.json";
import { help, segmented } from "../ui.js";
import { numRow } from "./rows.js";

export function initLevels(C, host) {
  const { S } = C, R = tc.refinement;
  const levels = (C.levels = R.levels.map((l) => l.id)), name = (id) => R.levels.find((l) => l.id === id).label, first = levels[0];
  const voxelOf = (id) => (id === "fine" ? S.vt : id === "normal" ? (R.draftVoxelMm + S.vt) / 2 : R.draftVoxelMm);
  C.reached = {}; C.gens = {}; C.workerLevel = null; C.levelWarn = ""; // gens[level] = { mesh, vol, over, sag }; workerLevel = level the worker holds now
  let lastDesignSig = null, lastVt = S.vt;
  C.applyRef = (id) => { S.ref = id; S.h = voxelOf(id); };
  C.resetLevels = (msg) => { const had = Object.values(C.reached).some(Boolean); C.reached = {}; C.gens = {}; C.workerLevel = null; C.applyRef(first); C.levelWarn = had ? msg : ""; };
  C.storeGen = (level, mesh, t, sg) => { // a level finished: keep its result so you can switch back to it
    C.gens[level] = { mesh, vol: t.volCm3, over: t.overhang, sag: sg }; C.workerLevel = level;
    if (t.connected) C.reached[level] = true; C.sync();
  };
  C.selectLevel = (id) => {
    C.applyRef(id); const g = C.gens[id];
    if (g && C.workerLevel !== id && C.restore(id)) C.ui.refOut.textContent = `Loading the ${name(id)} result…`; // the worker holds another level; afterwards Smooth works on this one
    else if (g) { C.clearCoarseGhost(); C.showResult(g.mesh); C.vol = g.vol; C.over = g.over; C.sag = g.sag; C.canClear = true; C.showSummary(); }
    C.sync();
  };
  C.isDraft = () => S.ref === first;
  C.levelName = name;
  C.canRefine = () => C.canClear && C.lastStats && C.lastStats.h > S.h * 1.001;

  const row = document.createElement("div"); row.className = "row"; row.innerHTML = "<label>Refinement</label>"; row.firstChild.append(help("refinement"));
  const seg = segmented(R.levels.map((l) => ({ id: l.id, label: l.label })), (id) => C.selectLevel(id));
  const hint = document.createElement("div"); hint.className = "rec";
  row.append(seg.el, hint); host.append(row);
  numRow(C, host, "Voxel target size (mm)", tc.voxelTarget, "vt", undefined, false, "voxelTarget");

  C.refreshers.push(() => {
    const dsig = JSON.stringify([S.vf, S.rmin, S.iters, S.budget, S.mass, S.accel, S.gdir, S.fx, S.fy, S.fz]);
    if (lastDesignSig !== null && dsig !== lastDesignSig && C.reached[first]) C.resetLevels("⚠ A design or load setting changed after the Draft, so Normal and Fine are locked again. Generate the Draft again.");
    lastDesignSig = dsig;
    if (S.vt !== lastVt) {
      lastVt = S.vt;
      const finer = levels.slice(1);
      if (finer.some((id) => C.gens[id])) { finer.forEach((id) => { delete C.gens[id]; delete C.reached[id]; }); C.levelWarn = "⚠ The voxel target size changed, so Normal and Fine need to be refined again."; if (S.ref !== first) setTimeout(() => C.selectLevel(first)); }
    }
    if (S.ref !== first) S.h = voxelOf(S.ref);
    levels.forEach((id, i) => seg.enable(id, i === 0 || !!C.reached[levels[i - 1]], i ? `Finish ${name(levels[i - 1])} first: ${name(id)} refines the ${name(first)} design and needs ${name(levels[i - 1])} done.` : ""));
    seg.set(S.ref);
    const todo = levels.findIndex((id) => !C.reached[id]); // first level not finished yet
    hint.className = C.levelWarn ? "warn" : "rec";
    hint.textContent = C.levelWarn || (todo < 0 ? "↳ All levels done. Click a level to switch between the results." : todo < levels.length - 1 ? `↳ Finish ${name(levels[todo])} to unlock ${name(levels[todo + 1])}.` : `↳ ${name(levels[todo - 1])} is done: ${name(levels[todo])} is unlocked.`);
    const lv = S.ref, ok = lv === first ? !!C.lastStats : !!(C.lastStats && C.reached[levels[levels.indexOf(lv) - 1]] && C.canClear && C.canRefine());
    C.ui.bGo.textContent = lv === first ? "Generate Draft" : (C.gens[lv] ? "Re-run " : "Refine to ") + name(lv);
    if (!C.busy()) C.ui.bGo.disabled = !ok;
  });
}
