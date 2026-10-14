// 3D view of stage 3: design-space preview, result, ghosts, load arrow, colour legend, and the weight / sag readout.
import * as THREE from "three";
import tc from "../../data/toolConnect.json";
import { loadVector } from "../geom/load.js";

export function initPreview(C) {
  const { S, scene, dom } = C;
  const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o }), glass = (color, opacity) => std({ color, transparent: true, opacity, depthWrite: false });
  const mats = (C.mats = { dom: glass(0x4a7fb5, 0.22), src: std({ color: 0x2ecc71 }), res: std({ color: 0xe6e6e6, metalness: 0.1, roughness: 0.6 }), avoid: glass(0xe53935, 0.45),
    coarse: glass(0x4a7fb5, 0.3), ghost: glass(0xff9800, 0.3) });
  C.prev = []; C.result = null; C.ghost = null; C.coarseGhost = null; let arrow = null;

  C.meshOf = (x, mat) => {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(x.p, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(x.n, 3)); bg.setIndex(new THREE.BufferAttribute(x.i, 1));
    const m = new THREE.Mesh(bg, mat); m.visible = C.active; scene.add(m); return m;
  };
  const drop = (m) => { scene.remove(m); m.geometry.dispose(); };
  C.clearGhost = () => { if (C.ghost) { drop(C.ghost); C.ghost = null; } };
  C.clearPrev = () => { C.prev.forEach(drop); C.prev = []; C.clearGhost(); };
  C.clearCoarseGhost = () => { if (C.coarseGhost) { drop(C.coarseGhost); C.coarseGhost = null; } };
  C.clearResult = () => {
    C.canClear = C.bridged = false; C.ui.clrOut.textContent = ""; C.ui.smOut.textContent = ""; C.vol = C.sag = C.over = null; C.showSummary();
    if (C.result) { drop(C.result); C.result = null; }
  };
  C.showResult = (d) => { C.clearResult(); C.result = C.meshOf(d, mats.res); };
  C.keep = (f) => { const v = C.vol, s = C.sag, o = C.over; f(); C.vol = v; C.sag = s; C.over = o; C.showSummary(); }; // showResult clears the readout
  C.setPrev = (d, s, a) => { // a new design space: everything after it starts again
    C.resetLevels("⚠ The setup changed, so you start again at Draft."); C.refined = false; C.ui.refOut.textContent = "";
    C.clearCoarseGhost(); C.clearPrev(); C.clearResult();
    C.prev = [C.meshOf(d, mats.dom), C.meshOf(s, mats.src)]; if (a && a.i.length) C.prev.push(C.meshOf(a, mats.avoid));
  };

  // one force on the tool end, drawn as a yellow arrow that ends at its centre of mass
  C.forceVec = () => loadVector(S.gdir, S.mass, S.accel, [S.fx, S.fy, S.fz]);
  C.drawArrow = () => {
    if (arrow) { scene.remove(arrow); arrow.dispose(); arrow = null; }
    const F = C.forceVec(), n = Math.hypot(...F); if (!C.cog || n < 1e-9) return;
    const L = tc.arrowLengthMm, dir = new THREE.Vector3(F[0] / n, F[1] / n, F[2] / n);
    arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(...C.cog).addScaledVector(dir, -L), L, 0xffd600, L * 0.25, L * 0.12);
    arrow.traverse((o) => { o.raycast = () => {}; o.renderOrder = 999; if (o.material) o.material.depthTest = false; }); // drawn on top, also inside the part
    arrow.visible = C.active && S.method === "optimize"; scene.add(arrow);
  };

  C.showSummary = () => { // weight and sag readout of the current result
    const out = C.ui.sumOut;
    if (C.vol == null) { out.textContent = ""; return; }
    const m = tc.material, F = Math.hypot(...C.forceVec()), { vol, sag, over } = C;
    out.innerHTML = [
      `Weight: about ${(vol * m.densityGcm3).toFixed(0)} g (${m.label}, solid, ${vol.toFixed(1)} cm³)`,
      sag != null ? `Sag at the tool: about ${sag < 0.01 ? sag.toPrecision(2) : sag.toFixed(2)} mm under ${F.toFixed(0)} N (rough, solid ${m.label})` : "",
      over != null ? `<span class="${over ? "warn" : "ok"}">${over ? `⚠ ${over.toLocaleString()} voxels overhang more than 45°` : "✔ No overhang above 45°: prints without supports"}</span>` : "",
    ].filter(Boolean).join("<br>");
  };

  const legend = document.createElement("div"); // colour key, only in stage 3
  legend.style.cssText = "position:absolute;bottom:8px;right:8px;z-index:5;display:none;font-size:11px;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:4px 8px;line-height:1.5";
  legend.innerHTML = [["#2ecc71", "connect"], ["#e53935", "avoid, clearance"], ["#ff9800", "gap"], ["#ffd600", "load"]].map(([col, t]) => `<span style="color:${col}">■</span> ${t}`).join("<br>");
  dom.parentElement.append(legend);

  C.stageVisibility = (stage) => { // what the 3D view shows in each stage
    const on = stage === "C";
    C.clearanceVisible(on); legend.style.display = on ? "" : "none";
    if (C.ghost) C.ghost.visible = on; if (arrow) arrow.visible = on && S.method === "optimize"; if (C.coarseGhost) C.coarseGhost.visible = on;
    C.prev.forEach((m) => (m.visible = on && !C.result)); if (C.result) C.result.visible = on || stage === "D"; // stage D (Export) shows the connector too
  };
}
