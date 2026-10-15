// The 3D view: renderer, camera, orbit, lights, grid, light/dark theme, drawing on demand,
// plus two helpers every stage uses: meshFrom (worker mesh → three.js mesh) and onViewClick (a click, not a drag, in the view).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { store } from "./store.js";

// a mesh from a worker: { p: positions, n: normals, i: triangle indices } (typed arrays)
export function meshFrom(m, mat) {
  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.BufferAttribute(m.p, 3)); bg.setAttribute("normal", new THREE.BufferAttribute(m.n, 3)); bg.setIndex(new THREE.BufferAttribute(m.i, 1));
  return new THREE.Mesh(bg, mat);
}

// fn(event, raycaster) on a click that did not move more than 4 px (an orbit drag is not a click). Mouse buttons: 0 left, 2 right.
export function onViewClick(dom, cam, fn) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam);
    fn(e, ray);
  });
}

export function initViewer(view) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio); view.append(renderer.domElement);
  const scene = new THREE.Scene();
  const tb = Object.assign(document.createElement("button"), { title: "Light / dark" });
  const setTheme = (light) => { document.body.classList.toggle("light", light); scene.background = new THREE.Color(light ? 0xf4f4f4 : 0x1e1f22); tb.textContent = light ? "☾" : "☀"; store.set("theme", light ? "light" : "dark"); };
  tb.onclick = () => setTheme(!document.body.classList.contains("light"));
  Object.assign(tb.style, { position: "absolute", top: "40px", left: "8px", width: "32px", fontSize: "16px" }); view.append(tb); setTheme(store.get("theme") === "light");
  const cam = new THREE.PerspectiveCamera(40, 1, 1, 2000); cam.up.set(0, 0, 1); cam.position.set(90, -90, 70);
  const orbit = new OrbitControls(cam, renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.2)); const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(50, -80, 120); scene.add(dl);
  const grid = new THREE.GridHelper(200, 20, 0x999999, 0xcccccc); grid.rotation.x = Math.PI / 2; scene.add(grid); scene.add(new THREE.AxesHelper(30));
  const resize = () => { renderer.setSize(view.clientWidth, view.clientHeight); cam.aspect = view.clientWidth / view.clientHeight; cam.updateProjectionMatrix(); };
  addEventListener("resize", resize); resize();
  // draw on demand: while something happens (input, orbit, worker replies, stage events) and for a moment after, not 60 times a second when idle
  let drawUntil = 0, drawing = false;
  const wake = () => { drawUntil = performance.now() + 1500; if (!drawing) { drawing = true; requestAnimationFrame(frame); } };
  function frame() { renderer.render(scene, cam); if (performance.now() < drawUntil) requestAnimationFrame(frame); else drawing = false; }
  for (const t of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "input", "change", "click", "resize"]) addEventListener(t, wake, { capture: true, passive: true });
  for (const t of ["stage", "advanced", "startbuilt", "workerreply"]) document.addEventListener(t, wake);
  orbit.addEventListener("change", wake); wake();
  return { renderer, scene, cam, orbit };
}
