// Hover highlight, shared by the face snapping (stage 2) and the Connect / Avoid clicks (stage 3):
// while the mouse moves over a part, the face (or object, or point) a click would pick is shown.
import * as THREE from "three";
import { overlayMesh, marker } from "./faceSnap.js";

// active()               true while this highlight should work
// targets()              [{ mesh, ... }]: the meshes that can be hovered
// describe(target, hit, e)  what a click would pick: { key, tris (triangle numbers, or null = whole mesh), color, point? (mesh space) } or null for nothing
export function initHover({ dom, cam, active, targets, describe }) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let shown = null, key = "";
  const clear = () => { if (shown) for (const m of shown) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); } shown = null; key = ""; };
  let last = null; // last mouse position, so pressing or releasing Shift updates the highlight without moving the mouse
  const move = (e) => {
    last = { clientX: e.clientX, clientY: e.clientY, buttons: e.buttons, shiftKey: e.shiftKey };
    if (e.buttons || !active()) return clear(); // no highlight while orbiting or dragging an arrow
    const r = dom.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam);
    const ts = targets(), meshes = ts.map((t) => { t.mesh.updateWorldMatrix(true, false); return t.mesh; });
    const hit = ray.intersectObjects(meshes, false)[0], d = hit && describe(ts[meshes.indexOf(hit.object)], hit, e);
    if (!d) return clear();
    const k = d.key + ":" + d.color; if (k === key) return; // same face, point and colour as a moment ago
    clear(); key = k;
    shown = [overlayMesh(hit.object, d.tris, d.color, 0.45)]; if (d.point) shown.push(marker(hit.object, d.point));
  };
  dom.addEventListener("pointermove", move);
  for (const t of ["keydown", "keyup"]) addEventListener(t, (e) => { if (e.key === "Shift" && last) move({ ...last, shiftKey: e.shiftKey }); });
  dom.addEventListener("pointerleave", () => { last = null; clear(); });
  document.addEventListener("stage", clear);
  return { clear };
}
