// Start-up: the geometry worker, the 3D view, and every stage wired together. Each stage lives in its own file.
import * as THREE from "three";
import { initFooterLinks } from './footerLinks.js';
import { initViewer } from './viewer.js';
import { initToolStart } from './toolStart/panel.js';
import { initToolEnd } from './toolEnd.js';
import { initToolConnect } from './toolConnect/index.js';
import { initObjectList } from './objectList.js';
import { initExport } from './exportStage.js';
import { initAdvanced, initSteps } from './ui.js';
import { rpc } from './rpc.js';

const $ = (id) => document.getElementById(id);
const geo = rpc(new Worker(new URL("./worker.js", import.meta.url), { type: "module" }), "geometry engine", // OpenCascade
  (text) => { $("status").textContent = "Geometry engine stopped"; $("msg").textContent = "✖ " + text; $("msg").className = "bad"; });

initAdvanced($("adv"));
const view = $("view"), { scene, cam, renderer, orbit } = initViewer(view);
const list = initObjectList({ view });
const startGroup = new THREE.Group(); scene.add(startGroup); // the tool start lives in this group so the list can hide it
list.add({ name: "Robotic flange", object: startGroup, deletable: false });

const toolStart = initToolStart({ geo, $, startGroup, list });
initFooterLinks();
const toolEnd = initToolEnd({ scene, cam, renderer, orbit, geo, $, list, view });
const toolConnect = initToolConnect({ scene, cam, renderer, $, getStart: toolStart.getInfo, list });
initExport({ geo, $, list, toolEnd, toolConnect, getStart: toolStart.getInfo, getFlangeId: toolStart.flangeId });
initSteps({
  A: toolStart.check,
  B: () => (toolEnd.getPart() ? null : "No object yet. Import a STEP file or add a primitive."),
  C: () => (toolConnect.connectedCount() ? null : "No face connected yet. Pick Connect face and click a face of the tool."),
  G: () => (toolConnect.getResult() ? null : "No connector yet. Connect a face in step 3 first."),
});
