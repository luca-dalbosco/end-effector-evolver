// Finite elements for the voxel design space: 8-node cube elements, matrix-free.
// Non-dimensional units: voxel edge = 1, Young's modulus = 1. Physical scaling comes later.

// 24x24 stiffness matrix of one cube element (2x2x2 Gauss integration).
export function hexKe(nu = 0.3) {
  const c = 1 / ((1 + nu) * (1 - 2 * nu)), D = new Float64Array(36);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) D[i * 6 + j] = c * (i === j ? 1 - nu : nu);
  for (let i = 3; i < 6; i++) D[i * 6 + i] = (c * (1 - 2 * nu)) / 2;
  const S = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const Ke = new Float64Array(576), B = new Float64Array(144), DB = new Float64Array(144), g = 1 / Math.sqrt(3);
  for (const gx of [-g, g]) for (const gy of [-g, g]) for (const gz of [-g, g]) {
    B.fill(0);
    S.forEach(([sx, sy, sz], a) => {
      const bx = (2 * sx * (1 + gy * sy) * (1 + gz * sz)) / 8, by = (2 * sy * (1 + gx * sx) * (1 + gz * sz)) / 8, bz = (2 * sz * (1 + gx * sx) * (1 + gy * sy)) / 8, o = 3 * a;
      B[o] = bx; B[24 + o + 1] = by; B[48 + o + 2] = bz;
      B[72 + o] = by; B[72 + o + 1] = bx;
      B[96 + o + 1] = bz; B[96 + o + 2] = by;
      B[120 + o] = bz; B[120 + o + 2] = bx;
    });
    for (let i = 0; i < 6; i++) for (let j = 0; j < 24; j++) { let s = 0; for (let k = 0; k < 6; k++) s += D[i * 6 + k] * B[k * 24 + j]; DB[i * 24 + j] = s; }
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { let s = 0; for (let k = 0; k < 6; k++) s += B[k * 24 + i] * DB[k * 24 + j]; Ke[i * 24 + j] += s / 8; }
  }
  return Ke;
}

// Grid of nx*ny*nz elements. Element e = i + nx*(j + ny*k). Node (i,j,k) = i + (nx+1)*(j + (ny+1)*k). DOF = 3*node + (0,1,2).
// active: optional Uint8Array(nel), 1 = element exists. density rho (0..1) -> stiffness Emin + (1-Emin)*rho^p.
export function createFem({ nx, ny, nz, active = null, Emin = 1e-6, p = 3, nu = 0.3 }) {
  const Ke = hexKe(nu), sx = nx + 1, sy = ny + 1, sz = sx * sy, nn = sz * (nz + 1), ndof = 3 * nn, nel = nx * ny * nz;
  const off = [0, 1, 1 + sx, sx, sz, sz + 1, sz + 1 + sx, sz + sx];
  const list = []; for (let e = 0; e < nel; e++) if (!active || active[e]) list.push(e);
  const elems = Int32Array.from(list), nAct = elems.length, base = new Int32Array(nAct), touched = new Uint8Array(nn);
  for (let q = 0; q < nAct; q++) {
    const e = elems[q], i = e % nx, j = Math.floor(e / nx) % ny, k = Math.floor(e / (nx * ny));
    base[q] = i + sx * j + sz * k;
    for (let a = 0; a < 8; a++) touched[base[q] + off[a]] = 1;
  }
  const autoFixed = new Uint8Array(ndof); // nodes no element touches cannot move
  for (let n = 0; n < nn; n++) if (!touched[n]) autoFixed[3 * n] = autoFixed[3 * n + 1] = autoFixed[3 * n + 2] = 1;
  let fixed = autoFixed.slice(), fixedList = new Int32Array(0);
  const Ee = new Float64Array(nel), diag = new Float64Array(ndof), invDiag = new Float64Array(ndof);
  const res = new Float64Array(ndof), zz = new Float64Array(ndof), pp = new Float64Array(ndof), qq = new Float64Array(ndof), xe = new Float64Array(24);

  const updateInv = () => { for (let d = 0; d < ndof; d++) invDiag[d] = fixed[d] || diag[d] <= 0 ? 0 : 1 / diag[d]; };
  function setFixed(mask) {
    fixed = autoFixed.slice(); if (mask) for (let d = 0; d < ndof; d++) if (mask[d]) fixed[d] = 1;
    const l = []; for (let d = 0; d < ndof; d++) if (fixed[d]) l.push(d);
    fixedList = Int32Array.from(l); updateInv();
  }
  function setDensity(rho) {
    diag.fill(0);
    for (let q = 0; q < nAct; q++) {
      const e = elems[q], E = Emin + (1 - Emin) * Math.pow(rho[e], p), n0 = base[q];
      Ee[e] = E;
      for (let a = 0; a < 8; a++) { const d0 = 3 * (n0 + off[a]); for (let d = 0; d < 3; d++) diag[d0 + d] += E * Ke[(3 * a + d) * 25]; }
    }
    updateInv();
  }
  function matvec(x, y) { // y = K x
    y.fill(0);
    for (let q = 0; q < nAct; q++) {
      const n0 = base[q], E = Ee[elems[q]];
      for (let a = 0; a < 8; a++) { const s = 3 * (n0 + off[a]), t = 3 * a; xe[t] = x[s]; xe[t + 1] = x[s + 1]; xe[t + 2] = x[s + 2]; }
      for (let i = 0; i < 24; i++) {
        let s = 0; const r0 = i * 24;
        for (let j = 0; j < 24; j++) s += Ke[r0 + j] * xe[j];
        const a = i / 3 | 0, d = i - 3 * a; y[3 * (n0 + off[a]) + d] += s * E;
      }
    }
    for (let k = 0; k < fixedList.length; k++) y[fixedList[k]] = 0;
  }
  // Solve K u = f with Jacobi-preconditioned conjugate gradients. u is the starting guess and the result.
  function solve(f, u, tol = 1e-6, maxIt = 1000) {
    for (let k = 0; k < fixedList.length; k++) u[fixedList[k]] = 0;
    matvec(u, qq);
    let rz = 0, fn = 0;
    for (let d = 0; d < ndof; d++) {
      const fd = fixed[d] ? 0 : f[d]; res[d] = fixed[d] ? 0 : fd - qq[d]; fn += fd * fd;
      zz[d] = invDiag[d] * res[d]; pp[d] = zz[d]; rz += res[d] * zz[d];
    }
    fn = Math.sqrt(fn) || 1;
    let it = 0, rel = 0;
    for (; it < maxIt; it++) {
      let rr = 0; for (let d = 0; d < ndof; d++) rr += res[d] * res[d];
      rel = Math.sqrt(rr) / fn; if (rel < tol) break;
      matvec(pp, qq);
      let pq = 0; for (let d = 0; d < ndof; d++) pq += pp[d] * qq[d];
      const alpha = rz / pq; let rzn = 0;
      for (let d = 0; d < ndof; d++) { u[d] += alpha * pp[d]; res[d] -= alpha * qq[d]; zz[d] = invDiag[d] * res[d]; rzn += res[d] * zz[d]; }
      const beta = rzn / rz; rz = rzn;
      for (let d = 0; d < ndof; d++) pp[d] = zz[d] + beta * pp[d];
    }
    return { iters: it, rel };
  }
  // Strain energy of each element for unit stiffness: ue' Ke ue (needed for the optimizer).
  function unitEnergy(u, out) {
    for (let q = 0; q < nAct; q++) {
      const n0 = base[q]; let en = 0;
      for (let a = 0; a < 8; a++) { const s = 3 * (n0 + off[a]), t = 3 * a; xe[t] = u[s]; xe[t + 1] = u[s + 1]; xe[t + 2] = u[s + 2]; }
      for (let i = 0; i < 24; i++) { let s = 0; for (let j = 0; j < 24; j++) s += Ke[i * 24 + j] * xe[j]; en += xe[i] * s; }
      out[elems[q]] = en;
    }
  }
  return { nx, ny, nz, nel, nn, ndof, nAct, Ee, node: (i, j, k) => i + sx * (j + sy * k), setFixed, setDensity, matvec, solve, unitEnergy };
}

// Self-test: three checks that must pass, and one comparison with beam theory.
// ratio = [min, max] allowed for cantilever tip drop / beam theory (from data/toolConnect.json)
export function selfTest(ratioRange = [0.7, 1.05]) {
  const out = [], ones = (n) => new Float64Array(n).fill(1);
  const Ke = hexKe(); let t = 0;
  for (let d = 0; d < 3; d++) for (let i = 0; i < 24; i++) { let s = 0; for (let a = 0; a < 8; a++) s += Ke[i * 24 + 3 * a + d]; t = Math.max(t, Math.abs(s)); }
  out.push({ ok: t < 1e-12, text: `Element matrix does not resist rigid movement (max ${t.toExponential(1)})` });

  { // straight pull: the exact answer is known for any mesh
    const nx = 8, ny = 3, nz = 2, fem = createFem({ nx, ny, nz }), nd = fem.node;
    fem.setDensity(ones(fem.nel));
    const fx = new Uint8Array(fem.ndof), f = new Float64Array(fem.ndof), u = new Float64Array(fem.ndof);
    for (let j = 0; j <= ny; j++) for (let k = 0; k <= nz; k++) {
      fx[3 * nd(0, j, k)] = 1;
      f[3 * nd(nx, j, k)] = ((j === 0 || j === ny ? 0.5 : 1) * (k === 0 || k === nz ? 0.5 : 1)) / (ny * nz);
    }
    fx[3 * nd(0, 0, 0) + 1] = fx[3 * nd(0, 0, 0) + 2] = fx[3 * nd(0, ny, 0) + 2] = 1;
    fem.setFixed(fx);
    const s = fem.solve(f, u, 1e-10, 2000), exact = nx / (ny * nz);
    let err = 0; for (let j = 0; j <= ny; j++) for (let k = 0; k <= nz; k++) err = Math.max(err, Math.abs(u[3 * nd(nx, j, k)] - exact) / exact);
    out.push({ ok: err < 1e-5 && s.rel < 1e-8, text: `Straight pull: end moves ${exact.toFixed(5)} as it should, error ${err.toExponential(1)}, ${s.iters} solver steps` });
    let c1 = 0; for (let d = 0; d < fem.ndof; d++) c1 += f[d] * u[d];
    const un = new Float64Array(fem.nel); fem.unitEnergy(u, un);
    let c2 = 0; for (let e = 0; e < fem.nel; e++) c2 += fem.Ee[e] * un[e];
    out.push({ ok: Math.abs(c1 - c2) / c1 < 1e-6, text: `Energy check: load × movement ${c1.toFixed(5)} equals the sum over elements ${c2.toFixed(5)}` });
  }

  { // cantilever beam compared with beam theory: proves the solver bends like a real beam (these elements are slightly too stiff, so a little below 1)
    const nx = 24, ny = 4, nz = 4, fem = createFem({ nx, ny, nz }), nd = fem.node;
    fem.setDensity(ones(fem.nel));
    const fx = new Uint8Array(fem.ndof), f = new Float64Array(fem.ndof), u = new Float64Array(fem.ndof), w = (j, k) => (j === 0 || j === ny ? 0.5 : 1) * (k === 0 || k === nz ? 0.5 : 1);
    for (let j = 0; j <= ny; j++) for (let k = 0; k <= nz; k++) {
      for (let d = 0; d < 3; d++) fx[3 * nd(0, j, k) + d] = 1;
      f[3 * nd(nx, j, k) + 2] = -w(j, k) / (ny * nz);
    }
    fem.setFixed(fx);
    const t0 = performance.now(), s = fem.solve(f, u, 1e-8, 5000), ms = performance.now() - t0;
    let tip = 0; for (let j = 0; j <= ny; j++) for (let k = 0; k <= nz; k++) tip += (-u[3 * nd(nx, j, k) + 2] * w(j, k)) / (ny * nz);
    const I = (ny * nz ** 3) / 12, G = 1 / (2 * 1.3), ref = nx ** 3 / (3 * I) + nx / ((5 / 6) * G * ny * nz), ratio = tip / ref;
    out.push({ ok: s.rel < 1e-6 && ratio >= ratioRange[0] && ratio <= ratioRange[1], text: `Cantilever beam: tip drop ${tip.toFixed(1)} vs beam theory ${ref.toFixed(1)} (ratio ${ratio.toFixed(2)}, must be ${ratioRange[0]} to ${ratioRange[1]}), ${s.iters} solver steps, ${ms.toFixed(0)} ms` });
  }
  return out;
}