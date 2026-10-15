// Export writers: binary STL, 3MF, STL zip, and the part pose (must match the 3D view).
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import * as THREE from "three";
import { stlBytes, threeMF, stlZip, placeSteps } from "../src/geom/export.js";

// one right triangle in the z = 0 plane, counter-clockwise seen from +z
const tri = { name: "A & <B>", p: Float32Array.of(0, 0, 0, 10, 0, 0, 0, 10, 0), i: Uint32Array.of(0, 1, 2) };

test("STL: size, triangle count, normal and corners", () => {
  const b = stlBytes(tri.p, tri.i), dv = new DataView(b.buffer);
  assert.equal(b.length, 84 + 50);
  assert.equal(dv.getUint32(80, true), 1);
  assert.deepEqual([0, 1, 2].map((k) => dv.getFloat32(84 + 4 * k, true)), [0, 0, 1]);
  assert.deepEqual([3, 4, 5, 6, 7, 8].map((k) => dv.getFloat32(84 + 4 * k, true)), [0, 0, 0, 10, 0, 0]);
});

test("3MF: valid zip, every vertex and triangle, names escaped, big meshes written in pieces", () => {
  const n = 50001, p = new Float32Array(3 * n), i = new Uint32Array(3 * (n - 2)); // more than two chunks
  for (let v = 0; v < n; v++) p[3 * v] = v;
  for (let f = 0; f < n - 2; f++) i.set([0, f + 1, f + 2], 3 * f);
  const files = unzipSync(threeMF([tri, { name: "big", p, i }]));
  assert.ok(files["[Content_Types].xml"] && files["_rels/.rels"]);
  const xml = strFromU8(files["3D/3dmodel.model"]);
  assert.equal(xml.match(/<vertex /g).length, 3 + n);
  assert.equal(xml.match(/<triangle /g).length, 1 + n - 2);
  assert.ok(xml.includes('name="A &amp; &lt;B&gt;"'));
  assert.ok(xml.endsWith('<item objectid="1"/><item objectid="2"/></build></model>'));
});

test("STL zip: one file per object, safe and unique names", () => {
  const names = Object.keys(unzipSync(stlZip([tri, { ...tri, name: "A & <B>" }, { ...tri, name: "" }])));
  assert.deepEqual(names, ["A _ _B_.stl", "A _ _B_-2.stl", "object.stl"]);
});

test("pose: the exported turns give the same point as the 3D view (three.js Euler XYZ)", () => {
  const turn = (v, deg, ax) => v.applyAxisAngle(new THREE.Vector3(...ax), (deg * Math.PI) / 180);
  for (const rot of [[0.3, -1.1, 2.0], [Math.PI / 2, 0, Math.PI / 6], [-0.7, 0.4, 0]]) {
    const view = new THREE.Vector3(1, 2, 3).applyEuler(new THREE.Euler(...rot, "XYZ")), out = new THREE.Vector3(1, 2, 3);
    for (const [deg, ax] of placeSteps(rot)) turn(out, deg, ax);
    assert.ok(out.distanceTo(view) < 1e-9, `${rot}: ${out.toArray()} vs ${view.toArray()}`);
  }
});
