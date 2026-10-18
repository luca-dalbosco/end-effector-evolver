// View cube in a corner of the 3D view: a small cube that turns with the camera. Click a face, an edge or a corner to look from there.
import * as THREE from "three";

const SIZE = 96, EDGE = 0.32; // canvas size in px; a click closer than this to the cube's edge (0.5 = edge) counts as the edge or corner
const FACES = ["Right", "Left", "Back", "Front", "Top", "Bottom"]; // three.js box order: +X, -X, +Y, -Y, +Z, -Z (Z is up, Front looks along +Y)

function label(text) {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
  g.fillStyle = "#d6d9de"; g.fillRect(0, 0, 128, 128); g.strokeStyle = "#8a8f98"; g.lineWidth = 8; g.strokeRect(0, 0, 128, 128);
  g.fillStyle = "#23262b"; g.font = "bold 28px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 64, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshBasicMaterial({ map: t });
}

export function initViewCube({ view, cam, orbit }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(devicePixelRatio); renderer.setSize(SIZE, SIZE); renderer.setClearAlpha(0);
  const dom = renderer.domElement; dom.title = "Click a face, edge or corner to look from there";
  dom.style.cssText = `position:absolute;bottom:8px;left:8px;width:${SIZE}px;height:${SIZE}px;z-index:4;cursor:pointer`; view.append(dom);
  const scene = new THREE.Scene(), cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), FACES.map(label)); scene.add(cube);
  const c2 = new THREE.PerspectiveCamera(30, 1, 0.1, 20); c2.up.set(0, 0, 1);
  const draw = () => { c2.position.copy(cam.position).sub(orbit.target).normalize().multiplyScalar(4.2); c2.lookAt(0, 0, 0); renderer.render(scene, c2); };
  orbit.addEventListener("change", draw); draw();

  // click: a face gives that view, near an edge or corner gives the edge or corner view
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null, anim = 0;
  const lookFrom = (dir) => { // turn the main camera smoothly to look from dir (it keeps its distance and target)
    cancelAnimationFrame(anim);
    const d = cam.position.distanceTo(orbit.target), from = cam.position.clone().sub(orbit.target).normalize(), to = dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, to), id = new THREE.Quaternion(); let t = 0;
    const step = () => {
      t = Math.min(1, t + 0.1);
      cam.position.copy(orbit.target).addScaledVector(from.clone().applyQuaternion(id.clone().slerp(q, t)), d); orbit.update();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    step();
  };
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; down = null;
    const r = dom.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, c2); const hit = ray.intersectObject(cube)[0]; if (!hit) return;
    const p = hit.point, n = hit.face.normal, dir = new THREE.Vector3();
    for (const a of ["x", "y", "z"]) if (Math.abs(n[a]) > 0.5 || Math.abs(p[a]) > EDGE) dir[a] = Math.sign(p[a]);
    lookFrom(dir);
  });
}
