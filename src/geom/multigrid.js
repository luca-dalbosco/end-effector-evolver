// Geometric multigrid preconditioner for the voxel stiffness solver (written from Amir, Aage & Lazarov 2014,
// "On multigrid-CG for efficient topology optimization", and the V-cycle in Briggs, Henson & McCormick, "A Multigrid Tutorial").
// Each coarser level has cubes twice as big. Its stiffness is the Galerkin product Pᵀ K P of the finer level, with P = trilinear
// interpolation from the coarse corners to the fine nodes, built cube by cube (a coarse cube = its 8 child cubes). Held (fixed)
// fine nodes are taken out of K first, so every level respects the supports. Smoothing: damped Jacobi, the damping set per level
// from its largest eigenvalue (power iteration). Coarsest level: solved exactly (Cholesky). Same smoothing before and after,
// so one V-cycle is a symmetric preconditioner, as conjugate gradients need.

const LOC = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]; // local node order of fem.js
const CODE = new Int8Array(8); LOC.forEach(([x, y, z], a) => (CODE[x + 2 * y + 4 * z] = a)); // child position → local index
// weight of coarse corner A (0/1) for a fine node at p (0, 1 or 2 fine cells from the coarse cube's low corner), per axis
const w1 = (p, A) => (p === 1 ? 0.5 : (p === 0) === (A === 0) ? 1 : 0);
// R[c][8a + A]: weight of coarse corner A for local node a of child cube c
const R = LOC.map(([ci, cj, ck]) => { const r = new Float64Array(64); LOC.forEach(([x, y, z], a) => LOC.forEach(([X, Y, Z], A) => (r[8 * a + A] = w1(ci + x, X) * w1(cj + y, Y) * w1(ck + z, Z)))); return r; });

// out (24×24 at oo) += s · (R_c ⊗ I3)ᵀ · M (24×24 at mo) · (R_c ⊗ I3)
const T = new Float64Array(576);
function galerkinAdd(out, oo, M, mo, r, s) {
  for (let i = 0; i < 24; i++) for (let B = 0; B < 8; B++) for (let e = 0; e < 3; e++) {
    let t = 0; for (let b = 0; b < 8; b++) { const w = r[8 * b + B]; if (w) t += M[mo + 24 * i + 3 * b + e] * w; }
    T[24 * i + 3 * B + e] = t;
  }
  for (let A = 0; A < 8; A++) for (let d = 0; d < 3; d++) for (let j = 0; j < 24; j++) {
    let t = 0; for (let a = 0; a < 8; a++) { const w = r[8 * a + A]; if (w) t += w * T[24 * (3 * a + d) + j]; }
    out[oo + 24 * (3 * A + d) + j] += s * t;
  }
}

const grid = (nx, ny, nz) => { const sx = nx + 1, sy = ny + 1, sz = sx * sy, nn = sz * (nz + 1); return { nx, ny, nz, sx, sy, sz, nn, ndof: 3 * nn, off: [0, 1, 1 + sx, sx, sz, sz + 1, sz + 1 + sx, sz + sx] }; };

// nx, ny, nz, elems (active fine cubes): the fine grid of fem.js. Ke: unit cube stiffness.
// fine: { mv(x, y) = K x, invDiag, fixed (1 = held) } of the fine level, read when used.
// o: data/toolConnect.json "solver.multigrid" (smoothingSteps, damping = ω × largest eigenvalue, powerSteps, directMaxDofs, maxLevels)
export function createMultigrid({ nx, ny, nz, elems, Ke, fine, o }) {
  const levels = [{ ...grid(nx, ny, nz), act: elems }];
  while (levels.length < o.maxLevels && levels[levels.length - 1].ndof > o.directMaxDofs) { // coarse cubes and which fine cubes they hold
    const F = levels[levels.length - 1]; if (F.nx < 2 && F.ny < 2 && F.nz < 2) break;
    const C = grid(Math.ceil(F.nx / 2), Math.ceil(F.ny / 2), Math.ceil(F.nz / 2)), map = new Int32Array(C.nx * C.ny * C.nz).fill(-1), list = [], kids = [];
    for (let q = 0; q < F.act.length; q++) {
      const e = F.act[q], i = e % F.nx, j = Math.floor(e / F.nx) % F.ny, k = Math.floor(e / (F.nx * F.ny)), E = (i >> 1) + C.nx * ((j >> 1) + C.ny * (k >> 1));
      if (map[E] < 0) { map[E] = list.length; list.push(E); kids.push(-1, -1, -1, -1, -1, -1, -1, -1); }
      kids[8 * map[E] + CODE[(i & 1) + 2 * (j & 1) + 4 * (k & 1)]] = q;
    }
    const n = list.length, base = new Int32Array(n);
    list.forEach((E, q) => { const i = E % C.nx, j = Math.floor(E / C.nx) % C.ny, k = Math.floor(E / (C.nx * C.ny)); base[q] = i + C.sx * j + C.sz * k; });
    levels.push({ ...C, act: Int32Array.from(list), kids: Int32Array.from(kids), base, A: new Float64Array(n * 576), diag: new Float64Array(C.ndof), invDiag: new Float64Array(C.ndof) });
  }
  const fineBase = new Int32Array(elems.length), F0 = levels[0];
  elems.forEach((e, q) => { const i = e % nx, j = Math.floor(e / nx) % ny, k = Math.floor(e / (nx * ny)); fineBase[q] = i + F0.sx * j + F0.sz * k; });
  for (const L of levels) { for (const k of ["b", "x", "r", "t"]) L[k] = new Float64Array(L.ndof); L.w = o.damping / 2; }
  const M = R.map((r) => { const m = new Float64Array(576); galerkinAdd(m, 0, Ke, 0, r, 1); return m; }); // first coarse level, cube without held nodes: Σ E · M_child
  const Kz = new Float64Array(576), held = new Uint8Array(24);
  const last = levels[levels.length - 1];
  let chol = null; // coarsest level: Cholesky factor (dense, lower triangle)

  // new densities or supports: coarse stiffness, diagonals, smoothing damping, coarsest factor
  function update(Ee) {
    const fx = fine.fixed;
    for (let l = 1; l < levels.length; l++) {
      const L = levels[l], F = levels[l - 1], A = L.A; A.fill(0);
      for (let q = 0; q < L.act.length; q++) for (let c = 0; c < 8; c++) {
        const qc = L.kids[8 * q + c]; if (qc < 0) continue;
        if (l > 1) { galerkinAdd(A, 576 * q, F.A, 576 * qc, R[c], 1); continue; }
        const E = Ee[F.act[qc]], n0 = fineBase[qc]; let any = 0;
        for (let a = 0; a < 8; a++) for (let d = 0; d < 3; d++) any |= held[3 * a + d] = fx[3 * (n0 + F.off[a]) + d];
        if (!any) { const m = M[c], o0 = 576 * q; for (let t = 0; t < 576; t++) A[o0 + t] += E * m[t]; continue; }
        for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) Kz[24 * i + j] = held[i] || held[j] ? 0 : E * Ke[24 * i + j]; // held nodes out of the cube
        galerkinAdd(A, 576 * q, Kz, 0, R[c], 1);
      }
      L.diag.fill(0);
      for (let q = 0; q < L.act.length; q++) for (let a = 0; a < 8; a++) { const d0 = 3 * (L.base[q] + L.off[a]); for (let d = 0; d < 3; d++) L.diag[d0 + d] += A[576 * q + (3 * a + d) * 25]; }
      const dmax = L.diag.reduce((m, v) => Math.max(m, v), 0);
      for (let d = 0; d < L.ndof; d++) L.invDiag[d] = L.diag[d] > 1e-12 * dmax ? 1 / L.diag[d] : 0; // nodes no cube moves stay out
    }
    for (let l = 0; l < levels.length - (levels.length > 1 ? 1 : 0); l++) levels[l].w = o.damping / lambdaMax(l);
    if (levels.length > 1) factor();
  }
  function lambdaMax(l) { // largest eigenvalue of D⁻¹K (power iteration; later calls start from the last vector, densities change little)
    const L = levels[l], iD = invD(l), y = L.t; let lam = 1;
    const first = !L.ev || !L.ev.some((v, d) => v !== 0 && iD[d]); // no usable vector from last time
    if (first) { L.ev ||= new Float64Array(L.ndof); for (let d = 0; d < L.ndof; d++) L.ev[d] = 1 + 0.37 * Math.sin(d); }
    const x = L.ev; for (let d = 0; d < L.ndof; d++) if (!iD[d]) x[d] = 0;
    for (let s = 0, n = first ? o.powerSteps : Math.ceil(o.powerSteps / 4); s < n; s++) {
      mv(l, x, y); let nx2 = 0, ny2 = 0;
      for (let d = 0; d < L.ndof; d++) { y[d] *= iD[d]; nx2 += x[d] * x[d]; ny2 += y[d] * y[d]; }
      lam = Math.sqrt(ny2 / (nx2 || 1)); const sc = 1 / (Math.sqrt(ny2) || 1); for (let d = 0; d < L.ndof; d++) x[d] = y[d] * sc;
    }
    return Math.max(lam, 1e-12) * 1.05; // a little margin: the power iteration approaches from below
  }
  function factor() { // dense Cholesky of the coarsest stiffness; unused nodes get a 1 on the diagonal
    const L = last, n = L.ndof, K = new Float64Array(n * n);
    for (let q = 0; q < L.act.length; q++) for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) for (let d = 0; d < 3; d++) for (let e = 0; e < 3; e++)
      K[n * (3 * (L.base[q] + L.off[a]) + d) + 3 * (L.base[q] + L.off[b]) + e] += L.A[576 * q + 24 * (3 * a + d) + 3 * b + e];
    for (let d = 0; d < n; d++) if (!L.invDiag[d]) { for (let e = 0; e < n; e++) K[n * d + e] = K[n * e + d] = 0; K[n * d + d] = 1; }
    for (let j = 0; j < n; j++) {
      let s = K[n * j + j]; for (let k = 0; k < j; k++) s -= K[n * j + k] ** 2;
      const djj = Math.sqrt(Math.max(s, 1e-30 * (K[n * j + j] || 1))); K[n * j + j] = djj;
      for (let i = j + 1; i < n; i++) { let t = K[n * i + j]; for (let k = 0; k < j; k++) t -= K[n * i + k] * K[n * j + k]; K[n * i + j] = t / djj; }
    }
    chol = K;
  }
  function solveCoarsest(b, x) {
    const n = last.ndof, K = chol;
    for (let i = 0; i < n; i++) { let s = last.invDiag[i] ? b[i] : 0; for (let k = 0; k < i; k++) s -= K[n * i + k] * x[k]; x[i] = s / K[n * i + i]; }
    for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let k = i + 1; k < n; k++) s -= K[n * k + i] * x[k]; x[i] = s / K[n * i + i]; }
    for (let i = 0; i < n; i++) if (!last.invDiag[i]) x[i] = 0;
  }

  const xe = new Float64Array(24);
  function mv(l, x, y) { // y = K x on level l (held nodes are already out of the coarse levels)
    if (l === 0) return fine.mv(x, y);
    const L = levels[l], A = L.A, off = L.off; y.fill(0);
    for (let q = 0; q < L.act.length; q++) {
      const n0 = L.base[q], o0 = 576 * q;
      for (let a = 0; a < 8; a++) { const s = 3 * (n0 + off[a]), t = 3 * a; xe[t] = x[s]; xe[t + 1] = x[s + 1]; xe[t + 2] = x[s + 2]; }
      for (let a = 0; a < 8; a++) { const s = 3 * (n0 + off[a]);
        for (let d = 0; d < 3; d++) { let v = 0; const r0 = o0 + 24 * (3 * a + d); for (let j = 0; j < 24; j++) v += A[r0 + j] * xe[j]; y[s + d] += v; } }
    }
  }
  const invD = (l) => (l === 0 ? fine.invDiag : levels[l].invDiag);
  function smooth(l, b, x, steps, fromZero) { // damped Jacobi: x += ω D⁻¹ (b − K x)
    const L = levels[l], iD = invD(l), w = L.w;
    for (let s = 0; s < steps; s++) {
      if (fromZero && s === 0) { for (let d = 0; d < L.ndof; d++) x[d] = w * iD[d] * b[d]; continue; }
      mv(l, x, L.t); for (let d = 0; d < L.ndof; d++) x[d] += w * iD[d] * (b[d] - L.t[d]);
    }
  }
  // each fine node takes from the 1, 2, 4 or 8 coarse corners around it (weights 1 or ½ per axis)
  function transfer(l, fineV, coarseV, up) { // up: coarse → fine (added); else fine → coarse (restriction, the transpose)
    const F = levels[l], C = levels[l + 1];
    if (!up) coarseV.fill(0);
    for (let k = 0; k <= F.nz; k++) { const K0 = k >> 1, nk = (k & 1) + 1, wk = k & 1 ? 0.5 : 1;
      for (let j = 0; j <= F.ny; j++) { const J0 = j >> 1, nj = (j & 1) + 1, wj = j & 1 ? 0.5 : 1;
        for (let i = 0; i <= F.nx; i++) { const I0 = i >> 1, ni = (i & 1) + 1, w = (i & 1 ? 0.5 : 1) * wj * wk, nf = 3 * (i + F.sx * (j + F.sy * k));
          if (!up && fineV[nf] === 0 && fineV[nf + 1] === 0 && fineV[nf + 2] === 0) continue;
          let s0 = 0, s1 = 0, s2 = 0;
          for (let kk = 0; kk < nk; kk++) for (let jj = 0; jj < nj; jj++) for (let ii = 0; ii < ni; ii++) {
            const nc = 3 * (I0 + ii + C.sx * (J0 + jj + C.sy * (K0 + kk)));
            if (up) { s0 += coarseV[nc]; s1 += coarseV[nc + 1]; s2 += coarseV[nc + 2]; }
            else { coarseV[nc] += w * fineV[nf]; coarseV[nc + 1] += w * fineV[nf + 1]; coarseV[nc + 2] += w * fineV[nf + 2]; }
          }
          if (up) { fineV[nf] += w * s0; fineV[nf + 1] += w * s1; fineV[nf + 2] += w * s2; }
        } } }
  }
  function vcycle(l, b, x) {
    if (l === levels.length - 1 && l > 0) return solveCoarsest(b, x);
    const L = levels[l];
    smooth(l, b, x, o.smoothingSteps, true);
    if (l === levels.length - 1) return smooth(l, b, x, o.smoothingSteps, false); // only one level: Jacobi only
    mv(l, x, L.t); for (let d = 0; d < L.ndof; d++) L.r[d] = b[d] - L.t[d];
    if (l === 0) { const fx = fine.fixed; for (let d = 0; d < L.ndof; d++) if (fx[d]) L.r[d] = 0; }
    const C = levels[l + 1]; transfer(l, L.r, C.b, false);
    vcycle(l + 1, C.b, C.x);
    transfer(l, x, C.x, true);
    if (l === 0) { const fx = fine.fixed; for (let d = 0; d < L.ndof; d++) if (fx[d]) x[d] = 0; }
    else for (let d = 0; d < L.ndof; d++) if (!L.invDiag[d]) x[d] = 0;
    smooth(l, b, x, o.smoothingSteps, false);
  }
  return { levels: levels.length, update, apply: (r, z) => vcycle(0, r, z), parts: { levels, mv, transfer } }; // parts: for the tests
}
