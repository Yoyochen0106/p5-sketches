/**
 * State-space models (small n) and conversions.
 *
 * A system is {A, B, C, D, n, delay} with A (n x n), B (n x m), C (p x n), D (p x m) given as arrays of rows
 * (x' = A x + B u, y = C x + D u). The factory ss() also accepts flat arrays for B (column) and C (row) and a number for D.
 * Only the SISO transfer-function conversions (tf2ss / ss2tf) are SISO-only; simulation handles several inputs.
 * Internals use ./_mat.js (small-n dense linear algebra, Taylor-based expm).
 */
import { mMul, mVec, mAdd, mScale, mT, meye, mzeros, msolve, charPoly, eigvals, zohMatrices, folMatrices } from './_mat.js';
import { tf, tfFromZpk, polyFromRoots } from './tf.js';

const col = (v) => (Array.isArray(v[0]) ? v.map((r) => r.slice()) : v.map((x) => [x]));
const row = (v) => (Array.isArray(v[0]) ? v.map((r) => r.slice()) : [v.slice()]);

/** Create a state-space object. */
export function ss(A, B, C, D = 0, delay = 0) {
  const n = A.length;
  const Bm = n ? col(B) : [];
  const Cm = row(C);
  const Dm = typeof D === 'number' ? [[D]] : D.map((r) => r.slice());
  return { A: A.map((r) => r.slice()), B: Bm, C: Cm, D: Dm, n, delay };
}
export const isSs = (s) => !!s && Array.isArray(s.A) && Array.isArray(s.B);

/**
 * Transfer function -> state space for a proper SISO TF.
 * form 'controllable' (default): phase-variable form, x = [y, y', ...] for D = 0;
 *   A = [[0 1 0],[0 0 1],[-an ... -a1]], B = [0..0 1]^T, C = [bn - an b0, ..., b1 - a1 b0], D = b0.
 * form 'observable': the dual (A^T, C^T, B^T).
 */
export function tf2ss(G, form = 'controllable') {
  const n = G.den.length - 1;
  if (G.num.length > G.den.length) throw new Error('tf2ss: improper transfer function');
  const lead = G.den[0];
  const a = G.den.map((c) => c / lead);                      // a[0] = 1
  const b = new Array(n + 1).fill(0);                        // b[k] multiplies s^(n-k)
  G.num.forEach((c, i) => { b[n + 1 - G.num.length + i] = c / lead; });
  const D = b[0];
  if (n === 0) return ss([], [], [], D, G.delay);
  const A = mzeros(n);
  for (let i = 0; i < n - 1; i++) A[i][i + 1] = 1;
  for (let j = 0; j < n; j++) A[n - 1][j] = -a[n - j];
  const B = mzeros(n, 1); B[n - 1][0] = 1;
  const C = [new Array(n).fill(0).map((_, j) => b[n - j] - a[n - j] * D)];
  if (form === 'observable') return ss(mT(A), mT(C), mT(B), D, G.delay);
  if (form !== 'controllable') throw new Error(`tf2ss: unknown form '${form}'`);
  return ss(A, B, C, D, G.delay);
}

/** State space -> transfer function (SISO) via the Faddeev-LeVerrier adjugate: C adj(sI-A) B / det(sI-A) + D. */
export function ss2tf(sys) {
  const { A, B, C, D, n } = sys;
  if (B[0] && B[0].length !== 1 || C.length !== 1) throw new Error('ss2tf: SISO only');
  const d = D[0][0];
  if (n === 0) return tf([d], [1], sys.delay || 0);
  const { c, adj } = charPoly(A, true);
  const num = new Array(n + 1).fill(0);
  for (let k = 0; k < n; k++) {
    const t = mMul(C, mMul(adj[k], B))[0][0];
    num[k + 1] += t;
  }
  for (let i = 0; i <= n; i++) num[i] += d * c[i];
  const mx = Math.max(...num.map(Math.abs), 1e-300);
  return tf(num.map((v) => (Math.abs(v) < 1e-12 * mx ? 0 : v)), c, sys.delay || 0);
}

/** State space from zeros, poles and gain k (controllable canonical realisation). */
export const zpk2ss = (zeros, poles, k = 1, delay = 0) => tf2ss(tfFromZpk(zeros, poles, k, delay));

/** Eigenvalues of A as [re, im] pairs. */
export const ssPoles = (sys) => eigvals(sys.A);

/** Controllability matrix [B AB ... A^(n-1) B]. */
export function controllabilityMatrix(sys) {
  const { A, B, n } = sys;
  let blk = B;
  const cols = [];
  for (let k = 0; k < n; k++) { cols.push(blk); blk = mMul(A, blk); }
  return B.map((_, i) => cols.flatMap((m) => m[i]));
}
/** Observability matrix [C; CA; ...; C A^(n-1)]. */
export function observabilityMatrix(sys) {
  const { A, C, n } = sys;
  let blk = C;
  const rows = [];
  for (let k = 0; k < n; k++) { rows.push(...blk); blk = mMul(blk, A); }
  return rows;
}
/** Numerical rank by Gaussian elimination with full pivoting (tolerance relative to the largest entry). */
export function matrixRank(M, tol = 1e-9) {
  const R = M.map((r) => r.slice());
  const mx = Math.max(1e-300, ...R.flat().map(Math.abs));
  let rank = 0;
  const rows = R.length, cols = R[0] ? R[0].length : 0;
  for (let c = 0; c < cols && rank < rows; c++) {
    let p = rank;
    for (let r = rank + 1; r < rows; r++) if (Math.abs(R[r][c]) > Math.abs(R[p][c])) p = r;
    if (Math.abs(R[p][c]) <= tol * mx) continue;
    [R[rank], R[p]] = [R[p], R[rank]];
    for (let r = rank + 1; r < rows; r++) {
      const f = R[r][c] / R[rank][c];
      for (let j = c; j < cols; j++) R[r][j] -= f * R[rank][j];
    }
    rank++;
  }
  return rank;
}
export const isControllable = (sys) => matrixRank(controllabilityMatrix(sys)) === sys.n;
export const isObservable = (sys) => matrixRank(observabilityMatrix(sys)) === sys.n;

/** p(A) for a polynomial p (highest power first). */
export function polyMatrix(p, A) {
  const n = A.length;
  let out = mzeros(n);
  for (const c of p) out = mAdd(mMul(out, A), mScale(meye(n), c));
  return out;
}

/**
 * Ackermann's formula for single-input pole placement: returns the row gain K (1 x n) such that eig(A - B K)
 * equals the requested poles (numbers or [re,im] conjugate-closed list). Requires a controllable pair.
 */
export function ackermann(sys, poles) {
  const phi = polyFromRoots(poles);
  const Co = controllabilityMatrix(sys);
  const last = new Array(sys.n).fill(0); last[sys.n - 1] = 1;
  const phiA = polyMatrix(phi, sys.A);
  // K = e_n^T Co^-1 phi(A)  =>  solve Co^T y = e_n,  K = y^T phi(A)
  const y = msolve(mT(Co), last.map((v) => [v])).map((r) => r[0]);
  return [mVec(mT(phiA), y)];
}
/** Observer gain L (n x 1) with eig(A - L C) at the requested poles (dual of Ackermann). */
export function observerGain(sys, poles) {
  const dual = ss(mT(sys.A), mT(sys.C), mT(sys.B), 0);
  return mT(ackermann(dual, poles));
}
/** Closed-loop system with state feedback u = -K x + r (poles of A - B K). */
export function stateFeedback(sys, K) {
  const BK = mMul(sys.B, K);
  return ss(sys.A.map((r, i) => r.map((v, j) => v - BK[i][j])), sys.B, sys.C, sys.D, sys.delay);
}

/**
 * Discretise exactly: method 'zoh' (u constant over each sample) or 'foh' (u piecewise linear).
 * Returns {Ad, Bd (zoh) | G0,G1 (foh), C, D, Ts, method}.
 */
export function c2dSs(sys, Ts, method = 'zoh') {
  if (method === 'foh') return { ...folMatrices(sys.A, sys.B, Ts), C: sys.C, D: sys.D, Ts, method };
  const { Ad, Bd } = zohMatrices(sys.A, sys.B, Ts);
  return { Ad, Bd, C: sys.C, D: sys.D, Ts, method: 'zoh' };
}

/** Normalise an input sample to an array over the inputs. */
const asVec = (u, m) => (Array.isArray(u) ? u : m === 1 ? [u] : new Array(m).fill(u));

/**
 * Simulate x' = A x + B u, y = C x + D u on a uniform grid with exact discretisation.
 * @param {object} sys state-space system (the `delay` field is ignored here; see response.js)
 * @param {Function|Array} input u(t) -> number|array, or an array of N+1 samples (one per grid point)
 * @param {{tEnd?:number, dt?:number, n?:number, x0?:number[], hold?:'zoh'|'foh'}} opts
 * @returns {{t:Float64Array, y:Float64Array[]|Float64Array, u:Float64Array, x:Float64Array[]}}
 *   y and u are Float64Array (first output / first input); yAll[j] and uAll[j] hold all channels.
 */
export function simulate(sys, input, opts = {}) {
  const { A, B, C, D, n } = sys;
  const m = B.length ? B[0].length : D[0].length;
  const p = C.length;
  let dt = opts.dt;
  let N;
  if (Array.isArray(input) && !opts.tEnd && !opts.n && dt) N = input.length - 1;
  else if (opts.n) { N = opts.n; if (!dt) dt = (opts.tEnd || 1) / N; }
  else { if (!dt) dt = (opts.tEnd || 10) / 1000; N = Math.max(1, Math.round((opts.tEnd || 10) / dt)); }
  const hold = opts.hold || 'zoh';
  const t = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) t[k] = k * dt;
  const uf = typeof input === 'function' ? input : (tk, k) => input[k];
  const us = new Array(N + 1);
  for (let k = 0; k <= N; k++) us[k] = asVec(uf(t[k], k), m);
  const x0 = opts.x0 ? opts.x0.slice() : new Array(n).fill(0);
  const X = new Array(N + 1);
  const Y = Array.from({ length: p }, () => new Float64Array(N + 1));
  const U = Array.from({ length: m }, () => new Float64Array(N + 1));
  let x = x0;
  let disc = null;
  if (n > 0) disc = hold === 'foh' ? folMatrices(A, B, dt) : zohMatrices(A, B, dt);
  for (let k = 0; k <= N; k++) {
    X[k] = Float64Array.from(x);
    const u = us[k];
    for (let j = 0; j < m; j++) U[j][k] = u[j];
    const yk = n ? mVec(C, x) : new Array(p).fill(0);
    for (let i = 0; i < p; i++) {
      let v = yk[i];
      for (let j = 0; j < m; j++) v += D[i][j] * u[j];
      Y[i][k] = v;
    }
    if (k === N || n === 0) continue;
    if (hold === 'foh') {
      const un = us[k + 1];
      const du = u.map((v, j) => (un[j] - v) / dt);
      const a = mVec(disc.Ad, x), b = mVec(disc.G0, u), c = mVec(disc.G1, du);
      x = a.map((v, i) => v + b[i] + c[i]);
    } else {
      const a = mVec(disc.Ad, x), b = mVec(disc.Bd, u);
      x = a.map((v, i) => v + b[i]);
    }
  }
  return { t, y: Y[0], yAll: Y, u: U[0], uAll: U, x: X, dt };
}

/**
 * Classical RK4 for a nonlinear system x' = f(x, u, t) with output y = h(x, u) (default y = x[0]).
 * u is a function of t (number or array) or a constant. Returns {t, x: Float64Array[], y: Float64Array, u}.
 * @param {{tEnd:number, dt?:number, substeps?:number, h?:Function}} opts dt is the output interval;
 *        each interval is integrated with `substeps` RK4 steps (input held constant: zero-order hold).
 */
export function rk4(f, x0, input, opts = {}) {
  const dt = opts.dt || (opts.tEnd || 10) / 1000;
  const N = Math.max(1, Math.round((opts.tEnd || 10) / dt));
  const sub = opts.substeps || 4;
  const h = opts.h || ((x) => x[0]);
  const uf = typeof input === 'function' ? input : () => input;
  const t = new Float64Array(N + 1), y = new Float64Array(N + 1), u = new Float64Array(N + 1);
  const X = new Array(N + 1);
  let x = x0.slice();
  const hs = dt / sub;
  for (let k = 0; k <= N; k++) {
    t[k] = k * dt;
    const uk = uf(t[k]);
    X[k] = Float64Array.from(x);
    u[k] = Array.isArray(uk) ? uk[0] : uk;
    y[k] = h(x, uk);
    if (k === N) break;
    for (let s = 0; s < sub; s++) {
      const tt = t[k] + s * hs;
      const k1 = f(x, uk, tt);
      const k2 = f(x.map((v, i) => v + 0.5 * hs * k1[i]), uk, tt + 0.5 * hs);
      const k3 = f(x.map((v, i) => v + 0.5 * hs * k2[i]), uk, tt + 0.5 * hs);
      const k4 = f(x.map((v, i) => v + hs * k3[i]), uk, tt + hs);
      x = x.map((v, i) => v + (hs / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }
  }
  return { t, x: X, y, u, dt };
}
