// 2D electrostatic boundary-value solver:  div( eps_r grad phi ) = -rho/eps0   on a rectangular node grid.
// Pure functions/classes, no DOM, no p5.
//
// GRID.  nx x ny nodes (cells + 1), spacing h [m], square cells.  Arrays are PADDED with one ghost layer:
//   stride S = nx + 2, index k = (j + 1) * S + (i + 1), size = S * (ny + 2).  Ghosts implement the boundary type:
//     grounded : outer ring of nodes is a Dirichlet conductor at 0 V (ghosts unused)
//     neumann  : zero normal field (mirror ghosts; the boundary nodes own half control volumes)
//     periodic : wrap-around; node nx-1 duplicates node 0 (and ny-1 duplicates 0) and both are updated identically
// DISCRETISATION.  5-point finite volume with harmonic-mean face permittivity (exact for planar interfaces
//   perpendicular to the grid axes):  sum_f c_f (phi_f - phi) / h^2 = -b ,  b = rho / eps0  [V/m^2].
// UNITS.  Capacitances and charges returned in "eps0 units" (C/eps0 [V], C'/eps0 dimensionless, W/eps0 [V^2]) per unit depth;
//   multiply by EPS0 for SI (C/m, F/m, J/m).
// SOLVERS.  Jacobi, Gauss-Seidel, SOR, red-black SOR and a geometric multigrid V-cycle (RB-GS smoother,
//   full-weighting restriction, bilinear prolongation, rediscretised coarse operators).

export const EPS0 = 8.8541878128e-12;
export const BCS = ['grounded', 'neumann', 'periodic'];
export const METHODS = [
  { id: 'jacobi', label: 'Jacobi' },
  { id: 'gs', label: 'Gauss-Seidel' },
  { id: 'sor', label: 'SOR' },
  { id: 'rb', label: 'Red-black SOR' },
  { id: 'mg', label: 'Multigrid V-cycle' },
];

/** Optimal SOR relaxation factor for the Poisson problem on an nx x ny node box (Dirichlet). */
export function optimalOmega(nx, ny) {
  const rj = (Math.cos(Math.PI / Math.max(2, nx - 1)) + Math.cos(Math.PI / Math.max(2, ny - 1))) / 2;
  return 2 / (1 + Math.sqrt(Math.max(0, 1 - rj * rj)));
}

/** Refresh the ghost layer of a padded array according to the boundary type. */
export function fillGhosts(a, nx, ny, bc) {
  const S = nx + 2;
  for (let j = 0; j < ny; j++) {
    const row = (j + 1) * S;
    if (bc === 'neumann') { a[row] = a[row + 2]; a[row + nx + 1] = a[row + nx - 1]; }
    else if (bc === 'periodic') { a[row] = a[row + nx - 1]; a[row + nx + 1] = a[row + 2]; }
    else { a[row] = a[row + 1]; a[row + nx + 1] = a[row + nx]; }
  }
  const last = (ny + 1) * S;
  let src0 = S, src1 = ny * S; // grounded: copy the edge row
  if (bc === 'neumann') { src0 = 2 * S; src1 = (ny - 1) * S; }
  else if (bc === 'periodic') { src0 = (ny - 1) * S; src1 = 2 * S; }
  for (let c = 0; c < S; c++) { a[c] = a[src0 + c]; a[last + c] = a[src1 + c]; }
}

const harm = (a, b) => 2 * a * b / (a + b);

// ---------------------------------------------------------------------------------------------
// Operator levels
// ---------------------------------------------------------------------------------------------

function buildLevel(nx, ny, bc, h, eps, fixed) {
  const S = nx + 2, size = S * (ny + 2);
  fillGhosts(eps, nx, ny, bc);
  const cE = new Float64Array(size), cN = new Float64Array(size), diag = new Float64Array(size);
  for (let k = 0; k + S < size; k++) {
    cE[k] = harm(eps[k], eps[k + 1]);
    cN[k] = harm(eps[k], eps[k + S]);
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j + 1) * S + i + 1;
      diag[k] = cE[k] + cE[k - 1] + cN[k] + cN[k - S];
    }
  }
  return { nx, ny, S, size, bc, h2: h * h, eps, fixed, cE, cN, diag };
}

function sweepGS(L, u, b, w) {
  const { nx, ny, S, cE, cN, diag, fixed, h2 } = L;
  fillGhosts(u, nx, ny, L.bc);
  for (let j = 0; j < ny; j++) {
    let k = (j + 1) * S + 1;
    for (let i = 0; i < nx; i++, k++) {
      if (fixed[k]) continue;
      const g = (cE[k] * u[k + 1] + cE[k - 1] * u[k - 1] + cN[k] * u[k + S] + cN[k - S] * u[k - S] + b[k] * h2) / diag[k];
      u[k] += w * (g - u[k]);
    }
  }
}

function sweepJacobi(L, u, un, b) {
  const { nx, ny, S, cE, cN, diag, fixed, h2 } = L;
  fillGhosts(u, nx, ny, L.bc);
  for (let j = 0; j < ny; j++) {
    let k = (j + 1) * S + 1;
    for (let i = 0; i < nx; i++, k++) {
      un[k] = fixed[k] ? u[k]
        : (cE[k] * u[k + 1] + cE[k - 1] * u[k - 1] + cN[k] * u[k + S] + cN[k - S] * u[k - S] + b[k] * h2) / diag[k];
    }
  }
  for (let j = 0; j < ny; j++) {
    const k0 = (j + 1) * S + 1;
    for (let i = 0; i < nx; i++) u[k0 + i] = un[k0 + i];
  }
}

function sweepRB(L, u, b, w) {
  const { nx, ny, S, cE, cN, diag, fixed, h2 } = L;
  for (let color = 0; color < 2; color++) {
    fillGhosts(u, nx, ny, L.bc);
    for (let j = 0; j < ny; j++) {
      let k = (j + 1) * S + 1;
      for (let i = (j + color) & 1; i < nx; i += 2) {
        const kk = k + i;
        if (fixed[kk]) continue;
        const g = (cE[kk] * u[kk + 1] + cE[kk - 1] * u[kk - 1] + cN[kk] * u[kk + S] + cN[kk - S] * u[kk - S] + b[kk] * h2) / diag[kk];
        u[kk] += w * (g - u[kk]);
      }
    }
  }
}

/** r = b - L u (L u = -div(eps grad u)); returns the rms residual over free nodes. */
function residualInto(L, u, b, r) {
  const { nx, ny, S, cE, cN, fixed, h2 } = L;
  fillGhosts(u, nx, ny, L.bc);
  let s = 0, n = 0;
  for (let j = 0; j < ny; j++) {
    let k = (j + 1) * S + 1;
    for (let i = 0; i < nx; i++, k++) {
      if (fixed[k]) { r[k] = 0; continue; }
      const uk = u[k];
      const rr = b[k] + (cE[k] * (u[k + 1] - uk) + cE[k - 1] * (u[k - 1] - uk) + cN[k] * (u[k + S] - uk) + cN[k - S] * (u[k - S] - uk)) / h2;
      r[k] = rr;
      s += rr * rr;
      n++;
    }
  }
  return Math.sqrt(s / Math.max(1, n));
}

// ---------------------------------------------------------------------------------------------
// Multigrid
// ---------------------------------------------------------------------------------------------

/** Geometric multigrid hierarchy built from a fine operator level (coefficients are immutable). */
export class Multigrid {
  constructor(fine) {
    this.levels = [fine];
    let L = fine;
    let h = Math.sqrt(fine.h2);
    while ((L.nx - 1) % 2 === 0 && (L.ny - 1) % 2 === 0 && L.nx - 1 > 4 && L.ny - 1 > 4) {
      const nxc = (L.nx - 1) / 2 + 1, nyc = (L.ny - 1) / 2 + 1;
      const Sc = nxc + 2, sizeC = Sc * (nyc + 2);
      const eps = new Float64Array(sizeC).fill(1);
      const fixed = new Uint8Array(sizeC);
      for (let J = 0; J < nyc; J++) {
        for (let I = 0; I < nxc; I++) {
          const kf = (2 * J + 1) * L.S + 2 * I + 1, kc = (J + 1) * Sc + I + 1, S = L.S;
          const e = L.eps;
          eps[kc] = (4 * e[kf] + 2 * (e[kf + 1] + e[kf - 1] + e[kf + S] + e[kf - S]) + e[kf + S + 1] + e[kf + S - 1] + e[kf - S + 1] + e[kf - S - 1]) / 16;
          // a coarse node is a conductor if its fine node or the fine node just above / right of it is:
          // thin electrodes stay alive (shifted by at most one fine cell)
          fixed[kc] = L.fixed[kf] || L.fixed[kf + 1] || L.fixed[kf + S] ? 1 : 0;
        }
      }
      h *= 2;
      L = buildLevel(nxc, nyc, L.bc, h, eps, fixed);
      this.levels.push(L);
    }
  }

  /** Per-solver scratch arrays. */
  makeWork() {
    return this.levels.map((L) => ({ u: new Float64Array(L.size), b: new Float64Array(L.size), r: new Float64Array(L.size) }));
  }

  /** One V-cycle on the fine level: improves u for the right-hand side b. */
  cycle(work, u, b, nu1 = 2, nu2 = 2) {
    this._cyc(work, 0, u, b, nu1, nu2);
  }

  _cyc(work, l, u, b, nu1, nu2) {
    const L = this.levels[l];
    if (l === this.levels.length - 1) {
      for (let s = 0; s < 40; s++) sweepRB(L, u, b, 1);
      return;
    }
    for (let s = 0; s < nu1; s++) sweepRB(L, u, b, 1);
    const w = work[l];
    residualInto(L, u, b, w.r);
    fillGhosts(w.r, L.nx, L.ny, L.bc);
    const C = this.levels[l + 1], wc = work[l + 1];
    const S = L.S, r = w.r;
    for (let J = 0; J < C.ny; J++) {
      for (let I = 0; I < C.nx; I++) {
        const kf = (2 * J + 1) * S + 2 * I + 1;
        wc.b[(J + 1) * C.S + I + 1] = (4 * r[kf] + 2 * (r[kf + 1] + r[kf - 1] + r[kf + S] + r[kf - S]) + r[kf + S + 1] + r[kf + S - 1] + r[kf - S + 1] + r[kf - S - 1]) / 16;
      }
    }
    wc.u.fill(0);
    this._cyc(work, l + 1, wc.u, wc.b, nu1, nu2);
    // bilinear prolongation of the coarse correction, free nodes only
    const e = wc.u, Sc = C.S;
    fillGhosts(e, C.nx, C.ny, C.bc);
    for (let j = 0; j < L.ny; j++) {
      const J = j >> 1, jo = j & 1;
      for (let i = 0; i < L.nx; i++) {
        const k = (j + 1) * S + i + 1;
        if (L.fixed[k]) continue;
        const I = i >> 1, io = i & 1;
        const kc = (J + 1) * Sc + I + 1;
        let v;
        if (!io && !jo) v = e[kc];
        else if (io && !jo) v = 0.5 * (e[kc] + e[kc + 1]);
        else if (!io && jo) v = 0.5 * (e[kc] + e[kc + Sc]);
        else v = 0.25 * (e[kc] + e[kc + 1] + e[kc + Sc] + e[kc + Sc + 1]);
        u[k] += v;
      }
    }
    for (let s = 0; s < nu2; s++) sweepRB(L, u, b, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Problem
// ---------------------------------------------------------------------------------------------

/**
 * A rectangular electrostatics problem. Fill `eps`, `rho`, `fixed`, `fixedV` (padded arrays, use idx(i,j)),
 * then call commit() (bumps `version`).  `rho` holds rho/eps0 in V/m^2.
 */
export class PoissonProblem {
  /** @param {{cells?:number, aspect?:number, bc?:string, width?:number}} o width = domain width in metres */
  constructor({ cells = 64, aspect = 1, bc = 'grounded', width = 0.1 } = {}) {
    this.cells = Math.max(4, Math.round(cells));
    this.cellsY = Math.max(4, Math.round(this.cells * aspect));
    this.nx = this.cells + 1;
    this.ny = this.cellsY + 1;
    this.S = this.nx + 2;
    this.size = this.S * (this.ny + 2);
    this.bc = BCS.includes(bc) ? bc : 'grounded';
    this.width = width;
    this.h = width / this.cells;
    this.eps = new Float64Array(this.size).fill(1);
    this.rho = new Float64Array(this.size);
    this.fixed = new Uint8Array(this.size);
    this.fixedV = new Float64Array(this.size);
    this.version = 0;
    this._mg = null;
    this.commit();
  }

  /** Padded index of node (i, j). */
  idx(i, j) { return (j + 1) * this.S + i + 1; }

  /** Normalised coordinates (u = x/width, v = y/width) of node (i, j). */
  uv(i, j) { return [i / this.cells, j / this.cells]; }

  /** Height of the domain in units of its width. */
  get aspect() { return this.cellsY / this.cells; }

  /** Control-volume fraction of node (i, j) (1/2 on Neumann boundaries, 1/4 in corners). */
  vol(i, j) {
    if (this.bc !== 'neumann') return 1;
    return ((i === 0 || i === this.nx - 1) ? 0.5 : 1) * ((j === 0 || j === this.ny - 1) ? 0.5 : 1);
  }

  /** Remove all content (eps = 1, rho = 0, no conductors except the grounded box). */
  clear() {
    this.eps.fill(1);
    this.rho.fill(0);
    this.fixed.fill(0);
    this.fixedV.fill(0);
    this.commit();
  }

  /** Re-derive boundary conductors, the effective source and the operators. Call after editing the arrays. */
  commit() {
    const { nx, ny } = this;
    if (this.bc === 'grounded') {
      for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) { const k = this.idx(i, j); this.fixed[k] = 1; this.fixedV[k] = 0; }
      for (let j = 0; j < ny; j++) for (const i of [0, nx - 1]) { const k = this.idx(i, j); this.fixed[k] = 1; this.fixedV[k] = 0; }
    }
    // periodic duplicates must agree
    if (this.bc === 'periodic') {
      for (let j = 0; j < ny; j++) this._dup(this.idx(0, j), this.idx(nx - 1, j));
      for (let i = 0; i < nx; i++) this._dup(this.idx(i, 0), this.idx(i, ny - 1));
    }
    fillGhosts(this.eps, nx, ny, this.bc);
    // source with the mean removed when the potential is only defined up to a constant
    this.hasDirichlet = false;
    for (let j = 0; j < ny && !this.hasDirichlet; j++) for (let i = 0; i < nx; i++) if (this.fixed[this.idx(i, j)]) { this.hasDirichlet = true; break; }
    this.b = Float64Array.from(this.rho);
    if (!this.hasDirichlet) {
      const ux = this.bc === 'periodic' ? nx - 1 : nx, uy = this.bc === 'periodic' ? ny - 1 : ny;
      let s = 0, v = 0;
      for (let j = 0; j < uy; j++) for (let i = 0; i < ux; i++) { const w = this.vol(i, j); s += w * this.rho[this.idx(i, j)]; v += w; }
      const m = s / v;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) this.b[this.idx(i, j)] -= m;
    }
    fillGhosts(this.b, nx, ny, this.bc);
    this.level = buildLevel(nx, ny, this.bc, this.h, this.eps.slice(), this.fixed);
    this._mg = null;
    this.version++;
  }

  _dup(a, b) {
    this.eps[b] = this.eps[a];
    this.rho[b] = this.rho[a];
    this.fixed[b] = this.fixed[a];
    this.fixedV[b] = this.fixedV[a];
  }

  /** Multigrid hierarchy for the current version (built lazily). */
  mg() {
    if (!this._mg) this._mg = new Multigrid(this.level);
    return this._mg;
  }

  /** Fresh potential array with the conductor voltages applied. */
  initialPhi() {
    const phi = new Float64Array(this.size);
    for (let k = 0; k < this.size; k++) if (this.fixed[k]) phi[k] = this.fixedV[k];
    return phi;
  }

  /** Number of free (non-conductor) nodes. */
  freeCount() {
    let n = 0;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) if (!this.fixed[this.idx(i, j)]) n++;
    return n;
  }
}

// ---------------------------------------------------------------------------------------------
// Iterative solver driver
// ---------------------------------------------------------------------------------------------

/**
 * One method iterating on its own copy of phi.  step(n) performs n iterations (V-cycles for 'mg');
 * `iters[]` / `res[]` hold the recorded history of the rms residual normalised by its first value.
 */
export class Solver {
  constructor(prob, method = 'sor', { omega = null, tol = 1e-9, maxIter = 40000 } = {}) {
    this.prob = prob;
    this.method = method;
    this.userOmega = omega;
    this.tol = tol;
    this.maxIter = maxIter;
    this.phi = prob.initialPhi();
    this.version = prob.version;
    this._scratch = null;
    this.work = null;
    this.restart(false);
  }

  get omega() {
    if (this.method === 'jacobi' || this.method === 'gs') return 1;
    if (this.method === 'mg') return 1;
    return this.userOmega || optimalOmega(this.prob.nx, this.prob.ny);
  }

  /** Forget the history (and optionally the solution). */
  restart(resetPhi = true) {
    if (resetPhi) this.phi = this.prob.initialPhi();
    this.iter = 0;
    this.iters = [];
    this.res = [];
    this.r0 = 0;
    this.residual = NaN;
    this.converged = false;
    this._rbuf = null;
  }

  _sync() {
    const p = this.prob;
    if (this.version === p.version) return;
    this.version = p.version;
    for (let k = 0; k < p.size; k++) if (p.fixed[k]) this.phi[k] = p.fixedV[k];
    this.work = null;
    this.restart(false);
  }

  /** Current rms residual (V/m^2). */
  measure() {
    const p = this.prob;
    if (!this._rbuf) this._rbuf = new Float64Array(p.size);
    return residualInto(p.level, this.phi, p.b, this._rbuf);
  }

  _record() {
    const r = this.measure();
    this.residual = r;
    if (this.iters.length === 0) this.r0 = r || 1;
    const it = this.iter;
    if (it < 100 || it % 5 === 0) {
      this.iters.push(it);
      this.res.push(r / this.r0);
      if (this.iters.length > 3000) {
        this.iters = this.iters.filter((_, n) => n % 2 === 0);
        this.res = this.res.filter((_, n) => n % 2 === 0);
      }
    }
    if (r / this.r0 < this.tol || r < 1e-30) this.converged = true;
  }

  /** Run n iterations. Returns the relative residual. */
  step(n = 1) {
    this._sync();
    const p = this.prob, L = p.level;
    if (this.iters.length === 0 && this.iter === 0) this._record();
    for (let s = 0; s < n && !this.converged && this.iter < this.maxIter; s++) {
      switch (this.method) {
        case 'jacobi':
          if (!this._scratch) this._scratch = new Float64Array(p.size);
          sweepJacobi(L, this.phi, this._scratch, p.b);
          break;
        case 'gs': sweepGS(L, this.phi, p.b, 1); break;
        case 'sor': sweepGS(L, this.phi, p.b, this.omega); break;
        case 'rb': sweepRB(L, this.phi, p.b, this.omega); break;
        case 'mg': {
          const mg = p.mg();
          if (!this.work) this.work = mg.makeWork();
          mg.cycle(this.work, this.phi, p.b);
          break;
        }
        default: throw new Error(`Solver: unknown method ${this.method}`);
      }
      this.iter++;
      this._record();
    }
    fillGhosts(this.phi, p.nx, p.ny, p.bc);
    return this.res.length ? this.res[this.res.length - 1] : 1;
  }
}

/** Solve to tolerance with multigrid; returns { phi, cycles, residual }. */
export function solve(prob, { tol = 1e-10, maxCycles = 80 } = {}) {
  const s = new Solver(prob, 'mg', { tol, maxIter: maxCycles });
  s.step(maxCycles);
  return { phi: s.phi, cycles: s.iter, residual: s.res[s.res.length - 1], solver: s };
}

// ---------------------------------------------------------------------------------------------
// Post-processing (unpadded outputs, index i + nx * j)
// ---------------------------------------------------------------------------------------------

/** E = -grad phi in V/m (central differences, one-sided on grounded walls). */
export function fieldFromPhi(prob, phi) {
  const { nx, ny, S, h } = prob;
  fillGhosts(phi, nx, ny, prob.bc);
  const ex = new Float32Array(nx * ny), ey = new Float32Array(nx * ny), mag = new Float32Array(nx * ny);
  const grounded = prob.bc === 'grounded';
  let max = 0, maxI = 0, maxJ = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j + 1) * S + i + 1;
      let dx, dy;
      if (grounded && (i === 0 || i === nx - 1)) dx = i === 0 ? (phi[k + 1] - phi[k]) / h : (phi[k] - phi[k - 1]) / h;
      else dx = (phi[k + 1] - phi[k - 1]) / (2 * h);
      if (grounded && (j === 0 || j === ny - 1)) dy = j === 0 ? (phi[k + S] - phi[k]) / h : (phi[k] - phi[k - S]) / h;
      else dy = (phi[k + S] - phi[k - S]) / (2 * h);
      const o = i + nx * j;
      ex[o] = -dx;
      ey[o] = -dy;
      const m = Math.hypot(dx, dy);
      mag[o] = m;
      if (m > max) { max = m; maxI = i; maxJ = j; }
    }
  }
  return { ex, ey, mag, max, maxI, maxJ, nx, ny };
}

/** Bilinear sample of an unpadded nx*ny field at normalised coordinates (u, v). Returns NaN outside. */
export function sampleField(prob, arr, u, v) {
  const { nx, ny, cells } = prob;
  const fx = u * cells, fy = v * cells;
  if (!(fx >= 0 && fy >= 0 && fx <= nx - 1 && fy <= ny - 1)) return NaN;
  const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy));
  const tx = fx - i, ty = fy - j;
  const a = arr[i + nx * j], b = arr[i + 1 + nx * j], c = arr[i + nx * (j + 1)], d = arr[i + 1 + nx * (j + 1)];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Charge carried by each conductor node (eps0 units, per unit depth): the flux of eps*E out of its control volume.
 * Divide by h for a surface charge density in eps0 * V/m.
 */
export function nodeCharges(prob, phi) {
  const { nx, ny, S, level: L } = prob;
  fillGhosts(phi, nx, ny, prob.bc);
  const q = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j + 1) * S + i + 1;
      if (!prob.fixed[k]) continue;
      const pk = phi[k];
      q[i + nx * j] = prob.vol(i, j) * (L.cE[k] * (pk - phi[k + 1]) + L.cE[k - 1] * (pk - phi[k - 1]) + L.cN[k] * (pk - phi[k + S]) + L.cN[k - S] * (pk - phi[k - S]));
    }
  }
  return q;
}

/** Electrostatic energy W/eps0 [V^2] per unit depth: 1/2 sum over edges of c_f (dphi)^2 (half weight on Neumann walls). */
export function fieldEnergy(prob, phi) {
  const { nx, ny, S, level: L } = prob;
  const neu = prob.bc === 'neumann';
  let w = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j + 1) * S + i + 1;
      if (i < nx - 1) {
        const d = phi[k + 1] - phi[k];
        w += (neu && (j === 0 || j === ny - 1) ? 0.5 : 1) * L.cE[k] * d * d;
      }
      if (j < ny - 1) {
        const d = phi[k + S] - phi[k];
        w += (neu && (i === 0 || i === nx - 1) ? 0.5 : 1) * L.cN[k] * d * d;
      }
    }
  }
  return 0.5 * w;
}

/** Conductor groups by voltage level: [{V, Q, nodes}] sorted by V descending. */
export function conductorGroups(prob, phi, q = nodeCharges(prob, phi)) {
  const map = new Map();
  const uniqX = prob.bc === 'periodic' ? prob.nx - 1 : prob.nx, uniqY = prob.bc === 'periodic' ? prob.ny - 1 : prob.ny;
  for (let j = 0; j < uniqY; j++) {
    for (let i = 0; i < uniqX; i++) {
      const k = prob.idx(i, j);
      if (!prob.fixed[k]) continue;
      const key = Math.round(prob.fixedV[k] * 1e6) / 1e6;
      let g = map.get(key);
      if (!g) { g = { V: key, Q: 0, nodes: 0 }; map.set(key, g); }
      g.Q += q[i + prob.nx * j];
      g.nodes++;
    }
  }
  return [...map.values()].sort((a, b) => b.V - a.V);
}

/**
 * Capacitance between the highest and the lowest voltage level, two ways:
 *   CQ = Q_high / dV                (charge method)      CW = 2 W / dV^2     (energy method)
 * both in eps0 units per unit depth (C'/eps0 is dimensionless).  Null when fewer than two levels or free charge is present.
 */
export function capacitance(prob, phi) {
  const groups = conductorGroups(prob, phi);
  if (groups.length < 2) return null;
  const dV = groups[0].V - groups[groups.length - 1].V;
  if (!(Math.abs(dV) > 1e-12)) return null;
  let freeCharge = 0;
  for (let j = 0; j < prob.ny; j++) for (let i = 0; i < prob.nx; i++) freeCharge += Math.abs(prob.rho[prob.idx(i, j)]);
  const W = fieldEnergy(prob, phi);
  return {
    CQ: groups[0].Q / dV,
    CW: 2 * W / (dV * dV),
    dV, Qhigh: groups[0].Q, energy: W, groups, hasFreeCharge: freeCharge > 0,
  };
}

/** Total free charge (rho/eps0 integrated, V*m... in eps0 units per unit depth): sum rho h^2. */
export function freeCharge(prob) {
  let s = 0;
  for (let j = 0; j < prob.ny; j++) for (let i = 0; i < prob.nx; i++) s += prob.vol(i, j) * prob.rho[prob.idx(i, j)];
  return s * prob.h * prob.h;
}

// ---------------------------------------------------------------------------------------------
// Analytic references
// ---------------------------------------------------------------------------------------------

/** Ideal parallel plate capacitance per unit depth / eps0 = eps_r * w / d (lengths in the same unit). */
export function parallelPlateC(width, gap, epsr = 1) {
  return epsr * width / gap;
}

/** Coaxial / concentric-cylinder capacitance per unit length / eps0 = 2 pi eps_r / ln(b / a). */
export function coaxC(a, b, epsr = 1) {
  return 2 * Math.PI * epsr / Math.log(b / a);
}

/** Coax potential for inner radius a at V, outer radius b at 0. */
export function coaxPotential(r, a, b, V) {
  if (r <= a) return V;
  if (r >= b) return 0;
  return V * Math.log(b / r) / Math.log(b / a);
}

/** Refraction check at a dielectric interface: angles from the normal on both sides and tan ratio vs eps ratio. */
export function refractionCheck(prob, field, u, v, nu, nv, epsA, epsB, delta = 0.04) {
  const nl = Math.hypot(nu, nv) || 1;
  nu /= nl;
  nv /= nl;
  const side = (s) => {
    const x = u + s * delta * nu, y = v + s * delta * nv;
    const ex = sampleField(prob, field.ex, x, y), ey = sampleField(prob, field.ey, x, y);
    const en = ex * nu + ey * nv, et = -ex * nv + ey * nu;
    return { en, et, theta: Math.atan2(Math.abs(et), Math.abs(en)) };
  };
  const A = side(-1), B = side(+1); // A on the epsA side (against the normal), B on the epsB side
  return {
    thetaA: A.theta, thetaB: B.theta,
    ratio: Math.tan(A.theta) / Math.tan(B.theta),
    expected: epsA / epsB,
  };
}

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------

/** Apply `fn(k, i, j)` to every node whose centre lies in a disk (normalised coordinates u, v, radius r). */
export function forDisk(prob, cu, cv, r, fn) {
  const c = prob.cells;
  const i0 = Math.max(0, Math.floor((cu - r) * c)), i1 = Math.min(prob.nx - 1, Math.ceil((cu + r) * c));
  const j0 = Math.max(0, Math.floor((cv - r) * c)), j1 = Math.min(prob.ny - 1, Math.ceil((cv + r) * c));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const du = i / c - cu, dv = j / c - cv;
      if (du * du + dv * dv <= r * r + 1e-12) fn(prob.idx(i, j), i, j);
    }
  }
}

/** Apply fn to every node in a rectangle [u0,u1] x [v0,v1]. */
export function forRect(prob, u0, v0, u1, v1, fn) {
  const c = prob.cells, e = 1e-9;
  const i0 = Math.max(0, Math.ceil(Math.min(u0, u1) * c - e)), i1 = Math.min(prob.nx - 1, Math.floor(Math.max(u0, u1) * c + e));
  const j0 = Math.max(0, Math.ceil(Math.min(v0, v1) * c - e)), j1 = Math.min(prob.ny - 1, Math.floor(Math.max(v0, v1) * c + e));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(prob.idx(i, j), i, j);
}

/** Apply fn to every node inside a polygon given as [[u, v], ...]. */
export function forPolygon(prob, pts, fn) {
  const c = prob.cells;
  for (let j = 0; j < prob.ny; j++) {
    for (let i = 0; i < prob.nx; i++) {
      const x = i / c, y = j / c;
      let inside = false;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        const pa = pts[a], pb = pts[b];
        if ((pa[1] > y) !== (pb[1] > y) && x < (pb[0] - pa[0]) * (y - pa[1]) / (pb[1] - pa[1]) + pa[0]) inside = !inside;
      }
      if (inside) fn(prob.idx(i, j), i, j);
    }
  }
}

/**
 * One brush dab centred on node (i0, j0). tool: 'conductor' (value = volts), 'dielectric' (value = eps_r),
 * 'charge' (value = rho/eps0 in V/m^2, additive when `add`), 'erase'.  radius in cells. Does NOT commit.
 */
export function stamp(prob, tool, i0, j0, radiusCells, value, add = false) {
  const c = prob.cells;
  const r = Math.max(0.5, radiusCells) / c;
  forDisk(prob, i0 / c, j0 / c, r, (k, i, j) => {
    const edge = i === 0 || j === 0 || i === prob.nx - 1 || j === prob.ny - 1;
    if (tool === 'conductor') {
      if (prob.bc === 'grounded' && edge) return;
      prob.fixed[k] = 1;
      prob.fixedV[k] = value;
    } else if (tool === 'dielectric') {
      prob.eps[k] = Math.max(1, value);
    } else if (tool === 'charge') {
      prob.rho[k] = add ? prob.rho[k] + value : value;
    } else if (tool === 'erase') {
      if (prob.bc === 'grounded' && edge) return;
      prob.fixed[k] = 0;
      prob.fixedV[k] = 0;
      prob.eps[k] = 1;
      prob.rho[k] = 0;
    }
  });
}

/** Copy painted content of `old` into `fresh` by nearest neighbour in normalised coordinates. */
export function resampleInto(fresh, old) {
  for (let j = 0; j < fresh.ny; j++) {
    for (let i = 0; i < fresh.nx; i++) {
      const u = i / fresh.cells, v = j / fresh.cells;
      const io = Math.round(u * old.cells), jo = Math.round(v * old.cells);
      if (io > old.nx - 1 || jo > old.ny - 1) continue;
      const ko = old.idx(io, jo), k = fresh.idx(i, j);
      fresh.eps[k] = old.eps[ko];
      fresh.rho[k] = old.rho[ko]; // rho/eps0 is a density: resolution independent
      fresh.fixed[k] = old.fixed[ko];
      fresh.fixedV[k] = old.fixedV[ko];
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Presets (geometry in normalised coordinates, u = x/width, v = y/width; aspect 1 assumed)
// ---------------------------------------------------------------------------------------------

/**
 * Each preset: { id, label, caption, bc, aspect, epsr?, make(prob, o) -> info } where o = { V, epsr, rho }.
 * info: { analytic?: { label, value (C'/eps0, dimensionless), note }, gap?, check? }.
 */
export const POISSON_PRESETS = [
  {
    id: 'plates', label: 'Parallel plates (ideal, 1-D)', bc: 'neumann', aspect: 1, usesEpsr: true,
    caption: 'Plates span the whole width and the side walls are Neumann, so the field is exactly uniform: C\' / eps0 = eps_r w / d to rounding error.',
    make(prob, o) {
      const jb = Math.round(0.25 * (prob.ny - 1)), jt = Math.round(0.75 * (prob.ny - 1)); // multigrid-friendly rows
      fillRows(prob, jb, jt, o);
      const d = (jt - jb) / prob.cells;
      return { analytic: { label: 'eps_r w / d', value: parallelPlateC(1, d, o.epsr), note: 'ideal parallel plates' }, gap: d };
    },
  },
  {
    id: 'plates-finite', label: 'Finite plate over a grounded floor', bc: 'grounded', aspect: 1, usesEpsr: true,
    caption: 'A finite plate at V above the grounded box floor: the ideal formula eps w / d underestimates C because of fringing and the back side of the plate.',
    make(prob, o) {
      const jp = Math.round(0.1 * prob.cells);
      const u0 = 0.2, u1 = 0.8;
      forRect(prob, u0, jp / prob.cells, u1, jp / prob.cells, (k) => { prob.fixed[k] = 1; prob.fixedV[k] = o.V; });
      forRect(prob, 0, 0, 1, jp / prob.cells, (k, i, j) => { if (j > 0 && !prob.fixed[k]) prob.eps[k] = o.epsr; });
      const d = jp / prob.cells;
      return { analytic: { label: 'eps_r w / d (ideal)', value: parallelPlateC(u1 - u0, d, o.epsr), note: 'fringe + back-side field add capacitance' }, gap: d };
    },
  },
  {
    id: 'coax', label: 'Concentric conductors (coax)', bc: 'grounded', aspect: 1, usesEpsr: true,
    caption: 'Inner cylinder at V inside a grounded ring. C\'/eps0 = 2 pi eps_r / ln(b/a); the staircase boundary gives a few percent error.',
    make(prob, o) {
      const a = 0.1, b = 0.36, t = 0.04;
      forDisk(prob, 0.5, 0.5, b, (k) => { prob.eps[k] = o.epsr; });
      forDisk(prob, 0.5, 0.5, a, (k) => { prob.fixed[k] = 1; prob.fixedV[k] = o.V; prob.eps[k] = 1; });
      // outer ring
      forDisk(prob, 0.5, 0.5, b + t, (k, i, j) => {
        const du = i / prob.cells - 0.5, dv = j / prob.cells - 0.5;
        if (Math.hypot(du, dv) >= b) { prob.fixed[k] = 1; prob.fixedV[k] = 0; prob.eps[k] = 1; }
      });
      return { analytic: { label: '2 pi eps_r / ln(b/a)', value: coaxC(a, b, o.epsr), note: `a = ${a}, b = ${b} (widths)` }, gap: b - a, coax: { a, b } };
    },
  },
  {
    id: 'wedge', label: 'Wedge / point electrode (lightning rod)', bc: 'neumann', aspect: 1, usesEpsr: false,
    caption: 'A grounded wedge hanging over a plate at V (symmetric Neumann sides): the field concentrates at the tip (enhancement beta = E_max / (V / gap)).',
    make(prob, o) {
      const jp = Math.round(prob.cells / 8);
      for (let i = 0; i < prob.nx; i++) { const k = prob.idx(i, jp); prob.fixed[k] = 1; prob.fixedV[k] = o.V; }
      forPolygon(prob, [[0.28, 1.001], [0.72, 1.001], [0.5, 0.375]], (k) => { prob.fixed[k] = 1; prob.fixedV[k] = 0; });
      return { gap: 0.375 - jp / prob.cells };
    },
  },
  {
    id: 'faraday', label: 'Shielded box (Faraday cage)', bc: 'grounded', aspect: 1, usesEpsr: false,
    caption: 'A grounded conducting shell between a charged plate and the wall: the field inside is nearly zero.',
    make(prob, o) { return faraday(prob, o, false); },
  },
  {
    id: 'faraday-open', label: 'Shielded box with a slot', bc: 'grounded', aspect: 1, usesEpsr: false,
    caption: 'The same shell with a slot in the side facing the plate: the field leaks in.',
    make(prob, o) { return faraday(prob, o, true); },
  },
  {
    id: 'dielectric', label: 'Dielectric slab refraction', bc: 'neumann', aspect: 1, usesEpsr: true, defaultEpsr: 4,
    caption: 'A tilted dielectric boundary between plates: field lines bend, tan(theta1) / tan(theta2) = eps1 / eps2.',
    make(prob, o) {
      const jb = Math.round(0.25 * (prob.ny - 1)), jt = Math.round(0.75 * (prob.ny - 1));
      fillRows(prob, jb, jt, { ...o, epsr: 1 });
      const s = 0.45;
      for (let j = jb; j <= jt; j++) {
        for (let i = 0; i < prob.nx; i++) {
          const u = i / prob.cells, v = j / prob.cells;
          if (v < 0.5 + s * (u - 0.5)) prob.eps[prob.idx(i, j)] = o.epsr;
        }
      }
      const n = Math.hypot(s, 1);
      return { gap: (jt - jb) / prob.cells, check: { kind: 'refraction', u: 0.5, v: 0.5, nu: -s / n, nv: 1 / n, epsA: o.epsr, epsB: 1 } };
    },
  },
  {
    id: 'charges', label: 'Free charges (+ / - blobs)', bc: 'grounded', aspect: 1, usesEpsr: false,
    caption: 'Painted charge density instead of conductors: Poisson\'s equation with the two blobs acting as a smeared dipole.',
    make(prob, o) {
      const r = o.rhoNorm || 1e6;
      forDisk(prob, 0.35, 0.5, 0.05, (k) => { prob.rho[k] = r; });
      forDisk(prob, 0.65, 0.5, 0.05, (k) => { prob.rho[k] = -r; });
      return {};
    },
  },
];

function fillRows(prob, jb, jt, o) {
  for (let i = 0; i < prob.nx; i++) {
    const kb = prob.idx(i, jb), kt = prob.idx(i, jt);
    prob.fixed[kb] = 1; prob.fixedV[kb] = 0;
    prob.fixed[kt] = 1; prob.fixedV[kt] = o.V;
  }
  for (let j = jb; j <= jt; j++) for (let i = 0; i < prob.nx; i++) prob.eps[prob.idx(i, j)] = o.epsr;
}

function faraday(prob, o, slot) {
  // left electrode
  forRect(prob, 0.1, 0.2, 0.125, 0.8, (k) => { prob.fixed[k] = 1; prob.fixedV[k] = o.V; });
  const u0 = 0.38, u1 = 0.82, v0 = 0.28, v1 = 0.72, t = 2 / prob.cells;
  const shell = (k) => { prob.fixed[k] = 1; prob.fixedV[k] = 0; };
  forRect(prob, u0, v0, u1, v0 + t, shell);
  forRect(prob, u0, v1 - t, u1, v1, shell);
  forRect(prob, u1 - t, v0, u1, v1, shell);
  forRect(prob, u0, v0, u0 + t, v1, shell);
  if (slot) {
    forRect(prob, u0 - 1e-6, 0.46, u0 + t + 1e-6, 0.54, (k) => { prob.fixed[k] = 0; prob.fixedV[k] = 0; });
  }
  return { check: { kind: 'shield', inside: [0.6, 0.5], outside: [0.24, 0.5] } };
}
