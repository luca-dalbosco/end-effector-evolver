# End Effector Evolver

A free, open-source browser tool that designs a **3D-printable connector between a robot flange and your own part** (a gripper, a sensor, an actuator…).

**100% local:** everything runs in your browser. There is no server and no account, and your files are never uploaded.

> **Use it online:** https://luca-dalbosco.github.io/end-effector-evolver/
> (published from the `main` branch by GitHub Pages)

> **Status: experimental.** Generated parts are not engineered, certified or load-rated. Check every dimension against the manufacturer datasheet, and test at low load and speed first. Use it at your own risk.

> **About the name:** this software uses **no evolutionary algorithm**. "Evolver" is just a playful name: the connector grows from design rules (and, in Voxel mode, from topology optimisation), a bit as if it evolved.

---

## How it works: 5 steps

| Tab | What you do |
|---|---|
| **1 Robot side** | Pick your robot and flange (or add a custom flange). Set the fit (Plate, Plate + Spigot, Plate + Spigot + Collar), thickness, screw head seats, dowel and tolerances. Export the robot side alone as STEP, STL or 3MF if you like. |
| **2 Tool** | Import your part as a STEP file, or add simple shapes (cube, cylinder, sphere…). Move and rotate them with the gizmo or by typing values. |
| **3 Preparation** | Click the faces the connector may attach to (green), and the faces or objects it must keep away from (red, with an adjustable gap shown as a see-through shell). Set Flange Clearance and Bolt Clearance so screws stay reachable. |
| **4 Generation** | **Bridge**: an instant solid wrap between the robot side and the tool. **Voxel**: topology optimisation that grows a lighter structure for your payload, from Draft to Normal to Fine, with optional smoothing. |
| **5 Export** | Save the robot side, the connector and the tool together or apart, as STL, 3MF or STEP. The connector is a mesh, so it exports as STL or 3MF only. |

Tabs 1, 3, 4 and 5 have an **Advanced mode** switch for extra settings. Every tab has `?` icons that explain each setting. The **Tutorial** link in the footer walks you through it step by step.

### Supported robots

| Brand | Model | Status |
|---|---|---|
| KUKA | KR 4 R600 | Needs printed verification |
| KUKA | KR 180 R2500 | Needs printed verification |
| Universal Robots | UR3e | Needs printed verification |

Flange numbers come only from manufacturer datasheets. Your robot is missing? Use **Brand → + Add custom flange…** (it is saved in your browser only), or [open an issue](https://github.com/luca-dalbosco/end-effector-evolver/issues) with the datasheet.

### Shortcuts

| Keys / mouse | Action |
|---|---|
| `Ctrl` + `Z` | Undo |
| `Ctrl` + `Shift` + `Z` or `Ctrl` + `Y` | Redo |
| Left-drag / right-drag / wheel | Orbit / pan / zoom the 3D view |
| `Shift` + click (tab 3) | Quick avoid: mark a face red |
| Right-click (tab 3) | Clear the green or red item under the cursor |

---

## Run it on your computer

1. Install [Node.js](https://nodejs.org) (LTS).
2. In this folder, run `npm install` once.
3. Run `npm run dev` and open the address it prints (usually http://localhost:5173).

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app locally, reloads on changes |
| `npm test` | Runs the automated checks (Node's built-in test runner, folder `test/`) |
| `npm run build` | Builds the static site into `dist/` |
| `npm run preview` | Serves the built `dist/` to check it before publishing |

**Publishing:** every push to `main` runs [.github/workflows/pages.yml](.github/workflows/pages.yml): it runs the tests, builds the site and publishes it on GitHub Pages. One-time setup on GitHub: *Settings → Pages → Source: GitHub Actions*.

---

## Project structure

```
data/                 every number setting (min, max, default, recommended ranges) and the flange data
  flanges.json        robot flanges, from manufacturer datasheets
  toolStart.json      tab 1: fit modes, thickness, screws, tolerances
  toolEnd.json        tab 2: primitives, import limits
  toolConnect.json    tabs 3 and 4: clearances, Bridge, Voxel solver, material
  export.json         tab 5: formats and mesh resolution
  help.json           the texts of every "?" icon
src/
  main.js             start-up: wires the stages together
  viewer.js           3D view (three.js): camera, theme, drawing on demand
  ui.js               shared UI pieces: sections, switches, number rows, tabs
  history.js          undo / redo
  objectList.js       the Objects list in the 3D view
  rpc.js              messages to the two workers (background threads)
  store.js            browser storage that never stops the app
  toolStart/          tab 1: panel.js (settings), flangeForm.js (custom flange), cad.js (CAD model)
  toolEnd.js          tab 2: import, primitives, gizmo
  toolConnect/        tabs 3 and 4: picking, clearances, Bridge / Voxel panel, 3D preview, worker requests
  exportStage.js      tab 5
  worker.js           geometry worker: OpenCascade (STEP import, robot side, export)
  voxelWorker.js      design worker: Bridge and Voxel generation
  geom/               pure maths, no screen code: FEM solver, multigrid, optimiser, voxels, meshing, file writers
test/                 automated tests (data ranges, geometry, solver, export, undo, worker messages)
third-party-licenses/ licence texts of the libraries used
```

### How Voxel generation works

Voxel uses topology optimisation (SIMP) with a density filter and an optimality-criteria update. A matrix-free finite-element solver with a multigrid preconditioner finds the stiffness. The optional print-ready filter follows Langelaar (2017), *An additive manufacturing filter for topology optimization of print-ready designs*. All algorithms are written from the papers, not copied from other projects. All heavy work runs in background workers, so the page stays responsive.

### Libraries

[three.js](https://github.com/mrdoob/three.js) (3D view), [Replicad](https://github.com/sgenoud/replicad) with [OpenCascade](https://dev.opencascade.org) (CAD geometry), [fflate](https://github.com/101arrowz/fflate) (zip / 3MF). The full list is under *Credits* in the app footer and in `third-party-licenses/`.

---

## Contributing and contact

- Bugs, questions and ideas: [GitHub Issues](https://github.com/luca-dalbosco/end-effector-evolver/issues)
- Support the project: [Ko-fi](https://ko-fi.com/lucad33107)

## Licence

Copyright © 2026 Luca Dalbosco and contributors. Released under the **GNU General Public License v3.0 or later** (see [LICENSE](LICENSE)). The parts you generate are yours.

Robot brand and model names belong to their owners; this project is not affiliated with them. Open CASCADE is licensed under LGPL 2.1 with an exception.

Designed by Luca Dalbosco · co-coded with Claude.
