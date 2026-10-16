// Flange Clearance (red cylinder below the robot side) and Bolt Clearance (slots above the screw heads and the dowel):
// the keep-out data sent to the worker, their 3D shapes and the Bolt Clearance panel rows.
import * as THREE from "three";
import tc from "../../data/toolConnect.json";
import { help, numberRow, pick } from "../ui.js";
import { head, btn, numRow, absRow } from "./rows.js";

export function initClearance(C, host) {
  const { S, scene, list, getStart } = C;
  C.robot = { mm: tc.avoid.robotOffsetMm.default }; // offset of the Flange Clearance cylinder around the plate
  const mat = new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const robotGroup = new THREE.Group(), boltGroup = new THREE.Group(); scene.add(robotGroup, boltGroup);
  const robotRow = list.add({ name: "Flange Clearance", object: robotGroup, deletable: false });
  const boltRow = list.add({ name: "Bolt Clearance", object: boltGroup, deletable: false });
  C.clearanceVisible = (on) => { list.setVis(robotRow, on ? 1 : 2); list.setVis(boltRow, on ? 1 : 2); }; // shown in step 3 only
  C.clearanceVisible(false);

  C.keepOut = () => { // plate cylinder from the bottom of the tool start up to the top face; robot cylinder below it; bolt slots
    const st = getStart(); if (!st) return null;
    const v = st.mesh.p; let zMin = Infinity; for (let i = 2; i < v.length; i += 3) zMin = Math.min(zMin, v[i]);
    const R = st.dims.plateOuter / 2, sc = st.dims.screws, t = st.dims.thickness;
    const bolts = [];
    if (sc && sc.headH) {
      const len = Math.max(0, st.dims.headD + S.bl), slot = S.bshape === "slot" ? Math.max(0, S.bslot) : 0, r = Math.max(0.1, (st.dims.headD + S.bd) / 2);
      sc.angles.forEach((a) => bolts.push({ x: sc.pcdR * Math.cos((a * Math.PI) / 180), y: sc.pcdR * Math.sin((a * Math.PI) / 180), r, z0: 0, z1: t + len, len: slot, pin: false })); // from the plate bottom: covers the whole bolt through the plate, seat included
      if (st.dims.pinHole) bolts.push({ x: sc.pcdR, y: 0, r: Math.max(0.1, (st.dims.dowelD + tc.bolt.diameterMarginMm + S.bd) / 2), z0: 0, z1: t + len, len: slot, pin: true }); // the dowel sits on the pitch circle at angle 0
    }
    return { R, zTop: t, zMin, robotR: R + C.robot.mm, bolts: bolts.length ? bolts : null, bed: S.print };
  };
  const clear = (g) => g.children.slice().forEach((m) => { g.remove(m); m.geometry.dispose(); });
  C.drawRobot = () => {
    clear(robotGroup); clear(boltGroup);
    const k = C.keepOut(); if (!k) return;
    const cyl = (r, z0, z1) => { const g = new THREE.CylinderGeometry(r, r, z1 - z0, 64); g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2); const m = new THREE.Mesh(g, mat); m.raycast = () => {}; robotGroup.add(m); };
    cyl(k.R, k.zMin, k.zTop); cyl(k.robotR, k.zMin - tc.avoid.robotLengthMm, k.zMin);
    for (const b of k.bolts || []) {
      const a = Math.atan2(b.y, b.x), ex = b.x + Math.cos(a) * b.len, ey = b.y + Math.sin(a) * b.len, sh = new THREE.Shape(); // slot outward from the bolt
      sh.moveTo(b.x - Math.sin(a) * b.r, b.y + Math.cos(a) * b.r); sh.lineTo(ex - Math.sin(a) * b.r, ey + Math.cos(a) * b.r);
      sh.absarc(ex, ey, b.r, a + Math.PI / 2, a - Math.PI / 2, true); sh.lineTo(b.x + Math.sin(a) * b.r, b.y - Math.cos(a) * b.r);
      sh.absarc(b.x, b.y, b.r, a - Math.PI / 2, a + Math.PI / 2, true);
      const g = new THREE.ExtrudeGeometry(sh, { depth: b.z1 - b.z0, bevelEnabled: false, curveSegments: 24 }); g.translate(0, 0, b.z0);
      const m = new THREE.Mesh(g, mat); m.raycast = () => {}; boltGroup.add(m);
    }
  };
  document.addEventListener("startbuilt", () => { C.drawRobot(); if (C.active) C.schedule(); });
  C.drawRobot();

  // ---------- panel: Bolt Clearance ----------
  head(host, "Bolt Clearance").append(help("boltClearance"));
  const boltInfo = document.createElement("div"); boltInfo.style.cssText = "font-size:12px;margin-bottom:4px"; host.append(boltInfo);
  absRow(C, host, "Diameter (mm)", tc.bolt.diameterAdjustMm, "bd", () => getStart()?.dims.headD ?? null);
  absRow(C, host, "Height (mm)", tc.bolt.lengthAdjustMm, "bl", () => getStart()?.dims.headD ?? null, 0); // lowest height = the top face of the tool start
  const bsRow = document.createElement("div"); bsRow.className = "row"; bsRow.innerHTML = "<label>Shape</label>";
  const bsSel = document.createElement("select"); tc.bolt.shape.options.forEach((o) => bsSel.add(new Option(o.label, o.id)));
  bsSel.onchange = pick(bsSel, "Bolt clearance shape", () => S.bshape, (v) => { S.bshape = v; C.sync(); C.drawRobot(); C.schedule(); });
  bsRow.append(bsSel); host.append(bsRow);
  numRow(C, host, "Slot length (mm)", tc.bolt.slotLengthMm, "bslot", () => S.bshape !== "slot");
  host.append(btn("Reset bolt clearance", () => { S.bd = tc.bolt.diameterAdjustMm.default; S.bl = tc.bolt.lengthAdjustMm.default; S.bshape = tc.bolt.shape.default; S.bslot = tc.bolt.slotLengthMm.default; C.sync(); C.drawRobot(); C.schedule(); }));
  // Robot Clearance: the cylinder below the robot side (it used to sit in the avoid list)
  const rc = tc.avoid.robotOffsetMm, rrec = rc.recommendedRange;
  const rr = numberRow({ label: "Robot Clearance (mm)", cfg: rc, help: "robotClearance", get: () => C.robot.mm, set: (v) => (C.robot.mm = v), live: () => { C.drawRobot(); C.sync(); }, commit: C.schedule,
    clamp: () => !C.advanced, note: `recommended ${rrec[0]} to ${rrec[1]}. ${rc.note}`, rate: (v) => (v >= rrec[0] && v <= rrec[1] ? "ok" : "warn") });
  rr.el.style.marginTop = "14px"; host.append(rr.el); C.refreshers.push(rr.refresh);
  C.refreshers.push(() => {
    bsSel.value = S.bshape;
    const b = C.keepOut()?.bolts, sc = b?.filter((x) => !x.pin), pin = b?.find((x) => x.pin);
    boltInfo.textContent = b ? `Above each of the ${sc.length} screws${S.bshape === "slot" ? `, as a slot running ${S.bslot} mm outward` : ""}.` + (pin ? ` Above the dowel: Ø ${(2 * pin.r).toFixed(2)} mm.` : "") : "No screw data for this flange.";
  });
}
