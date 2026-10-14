# End Effector Evolver

A browser tool that generates a 3D-printable connector between a robot flange and your own CAD part.
Everything runs locally in your browser. No server, no uploads.

**Although End Effector designs made by the tool grow from design rules (like they evolve), it has no evolutionary algorithms (at least not yet).**

Work in progress. Not released yet.

## Steps
1. **Robot side**: pick a robot and flange, set plate, screws and tolerances.
2. **Tool**: import a STEP file or add simple shapes, then position them.
3. **Connector**: generate the part that joins the two (Bridge = instant solid wrap, Voxel = topology optimisation).
4. **Export**: STL, 3MF or STEP.

## Run it
1. Install Node.js (LTS) from nodejs.org
2. In this folder run `npm install`
3. Run `npm run dev` and open the address it prints (usually http://localhost:5173)

`npm test` runs the automated checks. `npm run build` makes the static site in `dist/`.

Settings and flange data live in `data/*.json`.

## Licence
GNU GPL v3.0 (see `LICENSE`). Third-party licences are in `third-party-licenses/`.
