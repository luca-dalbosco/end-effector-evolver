// Mesh health check for exported files. Usage: node test/meshcheck.mjs file.stl|file.3mf [more files]
// Reports per object: triangles, open edges (1 triangle), non-manifold edges (3+), flipped edges, degenerate triangles, loose pieces, volume.
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

function parse(file) {
  const buf = fs.readFileSync(file), objs = [];
  if (file.toLowerCase().endsWith(".3mf")) {
    const xml = strFromU8(unzipSync(new Uint8Array(buf))["3D/3dmodel.model"]);
    for (const m of xml.matchAll(/<object [^>]*?name="([^"]*)"[^>]*>([\s\S]*?)<\/object>/g)) {
      const V = [...m[2].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((v) => [+v[1], +v[2], +v[3]]);
      const T = [...m[2].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((t) => [+t[1], +t[2], +t[3]]);
      objs.push({ name: m[1], V, T });
    }
  } else {
    const n = buf.readUInt32LE(80), V = [], T = [];
    for (let t = 0; t < n; t++) { const o = 84 + 50 * t + 12; T.push([0, 1, 2].map((c) => { V.push([0, 1, 2].map((a) => buf.readFloatLE(o + 12 * c + 4 * a))); return V.length - 1; })); }
    objs.push({ name: file, V, T });
  }
  return objs;
}

function report({ name, V, T }) {
  const id = new Map(), canon = V.map((p) => { const k = p.map((x) => x.toFixed(4)).join(","); if (!id.has(k)) id.set(k, id.size); return id.get(k); });
  const e = new Map(), par = [...id.values()].map((_, i) => i), find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  let degenerate = 0, vol = 0;
  for (const t of T) {
    const [a, b, c] = t.map((i) => canon[i]);
    if (a === b || b === c || a === c) { degenerate++; continue; }
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? `${p}_${q}` : `${q}_${p}`, r = e.get(k) || { n: 0, d: 0 }; r.n++; r.d += p < q ? 1 : -1; e.set(k, r); }
    par[find(a)] = find(b); par[find(b)] = find(c);
    const [A, B, C] = t.map((i) => V[i]);
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  }
  let open = 0, multi = 0, flipped = 0;
  for (const r of e.values()) { if (r.n === 1) open++; else if (r.n > 2) multi++; else if (r.d !== 0) flipped++; }
  const pieces = new Set([...e.keys()].map((k) => find(+k.split("_")[0]))).size;
  const ok = !open && !multi && !flipped && !degenerate && vol > 0;
  console.log(`${ok ? "OK  " : "BAD "} ${name}: ${T.length} tris, open ${open}, non-manifold ${multi}, flipped ${flipped}, degenerate ${degenerate}, pieces ${pieces}, volume ${(vol / 1000).toFixed(2)} cm3`);
  return ok;
}

const files = process.argv.slice(2);
if (!files.length) { console.log("Usage: node test/meshcheck.mjs file.stl|file.3mf ..."); process.exit(2); }
process.exit(files.flatMap(parse).map(report).every(Boolean) ? 0 : 1);
