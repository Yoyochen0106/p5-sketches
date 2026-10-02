/**
 * Direct factorizations: LU (partial pivoting), Cholesky, Householder QR, least squares,
 * Gram-Schmidt (classical / modified, with per-step data for visualisation).
 */
import { Matrix, asMatrix, asVec, dot } from './matrix.js';
import { svd } from './svd.js';

const EPS = 2.220446049250313e-16;

/**
 * LU factorization with partial pivoting: P A = L U.
 * @returns {{L: Matrix, U: Matrix, perm: number[], sign: number, singular: boolean, packed: Matrix}}
 *   perm[i] = original row index that ended up in row i (so (PA)[i] = A[perm[i]]); sign = det(P).
 */
export function lu(A) {
  A = asMatrix(A);
  if (!A.isSquare) throw new RangeError('lu: square matrix required');
  const n = A.rows, a = A.data.slice(), perm = Array.from({ length: n }, (_, i) => i);
  let sign = 1, singular = false;
  for (let k = 0; k < n; k++) {
    let p = k, best = Math.abs(a[k * n + k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(a[i * n + k]); if (v > best) { best = v; p = i; } }
    if (!(best > 0)) { singular = true; continue; }
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = a[k * n + j]; a[k * n + j] = a[p * n + j]; a[p * n + j] = t; }
      const t = perm[k]; perm[k] = perm[p]; perm[p] = t;
      sign = -sign;
    }
    const d = a[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = (a[i * n + k] /= d);
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) a[i * n + j] -= f * a[k * n + j];
    }
  }
  const L = Matrix.identity(n), U = new Matrix(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (j < i) L.data[i * n + j] = a[i * n + j]; else U.data[i * n + j] = a[i * n + j];
  }
  return { L, U, perm, sign, singular, packed: new Matrix(n, n, a) };
}

/** Solve A X = B using a factorization from `lu`. B is a Matrix (returns Matrix) or a vector (returns number[]). */
export function luSolve(F, B) {
  const n = F.packed.rows, a = F.packed.data;
  if (F.singular) throw new Error('singular matrix');
  const isVec = !(B instanceof Matrix) && !(Array.isArray(B) && Array.isArray(B[0]));
  const Bm = isVec ? Matrix.column(asVec(B)) : asMatrix(B);
  if (Bm.rows !== n) throw new RangeError('luSolve: dimension mismatch');
  const p = Bm.cols, x = new Float64Array(n * p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) x[i * p + j] = Bm.data[F.perm[i] * p + j];
  for (let i = 0; i < n; i++) for (let k = 0; k < i; k++) {
    const f = a[i * n + k];
    if (f !== 0) for (let j = 0; j < p; j++) x[i * p + j] -= f * x[k * p + j];
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let k = i + 1; k < n; k++) {
      const f = a[i * n + k];
      if (f !== 0) for (let j = 0; j < p; j++) x[i * p + j] -= f * x[k * p + j];
    }
    const d = a[i * n + i];
    for (let j = 0; j < p; j++) x[i * p + j] /= d;
  }
  return isVec ? Array.from(x) : new Matrix(n, p, x);
}

/** Solve A x = b (b: vector -> number[], or Matrix/nested -> Matrix). Throws on exactly singular A. */
export function solve(A, b) { return luSolve(lu(A), b); }
/** Matrix inverse via LU. Throws on exactly singular input. */
export function inverse(A) { A = asMatrix(A); return luSolve(lu(A), Matrix.identity(A.rows)); }
/** Determinant via LU (0 for exactly singular). */
export function det(A) {
  const F = lu(A);
  if (F.singular) return 0;
  const n = F.packed.rows;
  let d = F.sign;
  for (let i = 0; i < n; i++) d *= F.packed.data[i * n + i];
  return d;
}

/**
 * Cholesky factorization A = L L^T for symmetric positive definite A.
 * @returns {Matrix} lower-triangular L. Throws if A is not (numerically) positive definite.
 */
export function cholesky(A) {
  A = asMatrix(A);
  if (!A.isSquare) throw new RangeError('cholesky: square matrix required');
  const n = A.rows, L = new Matrix(n, n), l = L.data, a = A.data;
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j];
    for (let k = 0; k < j; k++) d -= l[j * n + k] * l[j * n + k];
    if (!(d > 0)) throw new Error('cholesky: matrix is not positive definite');
    const ljj = Math.sqrt(d);
    l[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= l[i * n + k] * l[j * n + k];
      l[i * n + j] = s / ljj;
    }
  }
  return L;
}
/** Like `cholesky` but returns null instead of throwing (positive-definiteness test). */
export function tryCholesky(A) { try { return cholesky(A); } catch { return null; } }
export const isPositiveDefinite = (A) => tryCholesky(A) !== null;

/** Solve A x = b given L from `cholesky(A)`. */
export function choleskySolve(L, b) {
  L = asMatrix(L);
  const isVec = !(b instanceof Matrix) && !(Array.isArray(b) && Array.isArray(b[0]));
  const B = isVec ? Matrix.column(asVec(b)) : asMatrix(b);
  const n = L.rows, p = B.cols, x = B.data.slice(), l = L.data;
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) {
    let s = x[i * p + j];
    for (let k = 0; k < i; k++) s -= l[i * n + k] * x[k * p + j];
    x[i * p + j] = s / l[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) for (let j = 0; j < p; j++) {
    let s = x[i * p + j];
    for (let k = i + 1; k < n; k++) s -= l[k * n + i] * x[k * p + j];
    x[i * p + j] = s / l[i * n + i];
  }
  return isVec ? Array.from(x) : new Matrix(n, p, x);
}

/**
 * Householder QR: A = Q R.
 * Default (full): Q is m x m orthogonal, R is m x n upper triangular.
 * `{thin: true}`: Q is m x k, R is k x n with k = min(m, n).
 * Note: diagonal of R may be negative (Householder sign convention).
 */
export function qr(A, { thin = false } = {}) {
  A = asMatrix(A);
  const m = A.rows, n = A.cols, R = A.data.slice(), Q = Matrix.identity(m), q = Q.data;
  const steps = Math.min(m - 1, n);
  const v = new Float64Array(m);
  for (let k = 0; k < Math.max(0, steps); k++) {
    let nrm = 0;
    for (let i = k; i < m; i++) nrm += R[i * n + k] * R[i * n + k];
    nrm = Math.sqrt(nrm);
    if (nrm === 0) continue;
    const alpha = R[k * n + k] > 0 ? -nrm : nrm;
    for (let i = k; i < m; i++) v[i] = R[i * n + k];
    v[k] -= alpha;
    let vv = 0;
    for (let i = k; i < m; i++) vv += v[i] * v[i];
    if (vv === 0) continue;
    const beta = 2 / vv;
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += v[i] * R[i * n + j];
      s *= beta;
      for (let i = k; i < m; i++) R[i * n + j] -= s * v[i];
    }
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = k; j < m; j++) s += q[i * m + j] * v[j];
      s *= beta;
      for (let j = k; j < m; j++) q[i * m + j] -= s * v[j];
    }
    for (let i = k + 1; i < m; i++) R[i * n + k] = 0;
  }
  const Rm = new Matrix(m, n, R);
  if (thin && m > n) return { Q: Q.block(0, m, 0, n), R: Rm.block(0, n, 0, n) };
  return { Q, R: Rm };
}

/**
 * Least squares  min ||A x - b||_2.
 * Full-column-rank problems use Householder QR; rank-deficient or under-determined ones use the SVD
 * pseudoinverse (minimum-norm solution). `b` may be a vector (-> x is number[]) or a Matrix.
 * @returns {{x: number[]|Matrix, residualNorm: number, rank: number, method: 'qr'|'svd'}}
 */
export function lstsq(A, b, { tol } = {}) {
  A = asMatrix(A);
  const isVec = !(b instanceof Matrix) && !(Array.isArray(b) && Array.isArray(b[0]));
  const B = isVec ? Matrix.column(asVec(b)) : asMatrix(b);
  if (B.rows !== A.rows) throw new RangeError('lstsq: dimension mismatch');
  const m = A.rows, n = A.cols, p = B.cols;
  let X = null, rank = 0, method = 'qr';
  if (m >= n) {
    const { Q, R } = qr(A);
    let mx = 0, mn = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(R.data[i * n + i]); mx = Math.max(mx, d); mn = Math.min(mn, d); }
    if (n > 0 && mn > (tol ?? Math.max(m, n) * EPS) * mx) {
      const QtB = Q.transpose().mul(B), x = new Float64Array(n * p);
      for (let j = 0; j < p; j++) for (let i = n - 1; i >= 0; i--) {
        let s = QtB.data[i * p + j];
        for (let k = i + 1; k < n; k++) s -= R.data[i * n + k] * x[k * p + j];
        x[i * p + j] = s / R.data[i * n + i];
      }
      X = new Matrix(n, p, x); rank = n;
    }
  }
  if (!X) {
    method = 'svd';
    const f = svd(A), s = f.S, smax = s[0] || 0, cut = tol !== undefined ? tol * smax : Math.max(m, n) * EPS * smax;
    const UtB = f.U.transpose().mul(B), x = new Matrix(n, p);
    for (let k = 0; k < s.length; k++) {
      if (!(s[k] > cut)) continue;
      rank++;
      for (let j = 0; j < p; j++) {
        const c = UtB.data[k * p + j] / s[k];
        for (let i = 0; i < n; i++) x.data[i * p + j] += f.V.data[i * f.V.cols + k] * c;
      }
    }
    X = x;
  }
  const res = A.mul(X).sub(B);
  return { x: isVec ? Array.from(X.data) : X, residualNorm: res.normFro(), rank, method };
}

/**
 * Gram-Schmidt orthonormalization of the columns of A, keeping every step for visualisation.
 *
 * @param {Matrix|number[][]} A m x n
 * @param {{modified?: boolean, tol?: number}} [opts] modified=false: classical (projections use the ORIGINAL a_j);
 *   modified=true: each projection uses the running vector (numerically more stable).
 * @returns {{Q: Matrix, R: Matrix, rank: number, steps: Array}}
 *   steps[j] = { j, original: a_j, projections: [{i, coeff, vector: coeff*q_i, after: running vector after subtracting}],
 *                residual: unnormalised vector, norm, q: q_j (zeros if dependent), dependent: boolean }.
 *   A = Q R with Q having orthonormal (or zero, for dependent columns) columns; R is n x n upper triangular.
 */
export function gramSchmidt(A, { modified = false, tol = 1e-12 } = {}) {
  A = asMatrix(A);
  const m = A.rows, n = A.cols, qs = [], steps = [], R = new Matrix(n, n);
  let rank = 0;
  const scale = Math.max(1e-300, A.maxAbs());
  for (let j = 0; j < n; j++) {
    const aj = A.colVec(j), v = aj.slice(), projections = [];
    for (let i = 0; i < j; i++) {
      const qi = qs[i];
      if (!qi) continue;
      const coeff = dot(qi, modified ? v : aj);
      R.data[i * n + j] = coeff;
      for (let k = 0; k < m; k++) v[k] -= coeff * qi[k];
      projections.push({ i, coeff, vector: qi.map((x) => x * coeff), after: v.slice() });
    }
    const norm = Math.sqrt(dot(v, v));
    const dependent = !(norm > tol * scale * Math.max(1, m));
    let q;
    if (dependent) q = new Array(m).fill(0);
    else { q = v.map((x) => x / norm); R.data[j * n + j] = norm; rank++; }
    qs.push(dependent ? null : q);
    steps.push({ j, original: aj, projections, residual: v.slice(), norm, q, dependent });
  }
  const Q = Matrix.fromFunction(m, n, (i, j) => steps[j].q[i]);
  return { Q, R, rank, steps };
}
