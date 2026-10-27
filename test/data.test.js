// Settings files (data/*.json): every number setting is consistent, so the UI never builds a broken slider.
// Flange data is only checked for shape and plausibility. It is never changed by code: a failure here must go to Luca.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const files = readdirSync(new URL("../data/", import.meta.url)).filter((f) => f.endsWith(".json"));

// every object that has min and max, with its path
function settings(o, path = "", out = []) {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    if (typeof o.min === "number" && typeof o.max === "number") out.push([path, o]);
    for (const [k, v] of Object.entries(o)) settings(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

for (const f of files) {
  test(`${f}: valid JSON`, () => { assert.doesNotThrow(() => load(f)); });
  test(`${f}: every range setting is consistent`, () => {
    for (const [p, s] of settings(load(f))) {
      assert.ok(s.min <= s.max, `${p}: min ${s.min} > max ${s.max}`);
      if (typeof s.default === "number") assert.ok(s.default >= s.min && s.default <= s.max, `${p}: default ${s.default} outside ${s.min}..${s.max}`);
      if (s.step != null) assert.ok(s.step > 0, `${p}: step must be above 0`);
      for (const key of ["recommendedRange", "notRecommendedRange"]) {
        const r = s[key]; if (!r) continue;
        assert.ok(Array.isArray(r) && r.length === 2 && r[0] <= r[1], `${p}.${key} must be [low, high]`);
        assert.ok(r[0] >= s.min && r[1] <= s.max, `${p}.${key} ${r} outside ${s.min}..${s.max}`);
      }
    }
  });
  test(`${f}: every default is one of its options`, () => {
    const walk = (o, p) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o.options) && o.default != null && typeof o.default !== "boolean") {
        const ids = o.options.map((x) => (typeof x === "object" ? x.id : x));
        assert.ok(ids.includes(o.default), `${p}: default "${o.default}" is not in ${ids}`);
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
    };
    walk(load(f), f);
  });
}

test("help.json: every text is a non-empty string", () => {
  for (const [k, v] of Object.entries(load("help.json"))) assert.ok(typeof v === "string" && v.trim(), `help ${k}`);
});

test("toolConnect.json: solver block is complete", () => {
  const s = load("toolConnect.json").solver;
  for (const k of ["penalty", "minStiffness", "moveLimit", "stopChange", "minSteps", "shrinkSettleSteps"]) assert.equal(typeof s[k], "number", k);
  for (const k of ["firstStep", "laterSteps"]) { assert.ok(s[k].tolerance > 0); assert.ok(s[k].maxCgIterations > 0); }
});

test("toolStart.json: screw heads are bigger than the screw and grow with it", () => {
  const sc = load("toolStart.json").screwClearance, sizes = Object.keys(sc.headDiameterByScrew);
  assert.deepEqual(sizes, Object.keys(sc.headHeightByScrew), "same sizes in both tables");
  let last = 0;
  for (const m of sizes) {
    const d = parseFloat(m.slice(1)), dk = sc.headDiameterByScrew[m];
    assert.ok(dk > d && sc.headHeightByScrew[m] === d, `${m}: head ${dk} mm, height ${sc.headHeightByScrew[m]} mm`);
    assert.ok(d > last, `${m} is out of order`); last = d;
  }
});

test("flanges.json: every flange has what the generator needs", () => {
  const { flanges } = load("flanges.json"), ids = new Set();
  for (const f of flanges) {
    assert.ok(f.id && !ids.has(f.id), `duplicate or missing id ${f.id}`); ids.add(f.id);
    assert.ok(f.brand && f.model, `${f.id}: brand and model`);
    if (f.status === "needs data") continue;
    const g = f.geometry, h = g.threadedHoles;
    assert.ok(g.pitchCircleDiameter > 0, `${f.id}: pitch circle`);
    assert.ok(/^M\d+(\.\d+)?$/.test(h.thread), `${f.id}: thread "${h.thread}"`);
    assert.ok(load("toolStart.json").screwClearance.headDiameterByScrew[h.thread], `${f.id}: no screw head data for ${h.thread}`);
    assert.ok(Array.isArray(h.anglesDeg) || (h.count > 0 && typeof h.startAngleDeg === "number" && h.spacingDeg > 0), `${f.id}: hole pattern`);
    assert.ok(g.raisedSpigot || g.outerDiameter > 0, `${f.id}: needs a raised spigot or an outer diameter`);
    const angles = Array.isArray(h.anglesDeg) ? h.anglesDeg : Array.from({ length: h.count }, (_, i) => h.startAngleDeg + i * h.spacingDeg);
    const norm = (a) => ((a % 360) + 360) % 360;
    assert.equal(new Set(angles.map((a) => norm(a).toFixed(3))).size, angles.length, `${f.id}: two screw holes at the same angle`);
    if (g.locatingPin) assert.ok(!angles.some((a) => (g.locatingPin.anglesDeg ?? [g.locatingPin.angleDeg ?? 0]).some((p) => Math.abs(norm(a) - norm(p)) < 1e-6)), `${f.id}: a screw hole sits on a dowel`);
  }
});
