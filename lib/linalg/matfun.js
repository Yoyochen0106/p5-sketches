/**
 * Matrix functions: expm (scaling & squaring + Pade 13, Higham 2005), exact discretisation via the Van Loan
 * block trick, functions / powers of diagonalizable matrices, characteristic polynomial (Faddeev-LeVerrier),
 * Jordan-structure detection.
 */
import { Matrix, CMatrix, asMatrix, blocks } from './matrix.js';
import { lu, luSolve } from './decomp.js';
import { eig, eigvals } from './eigen.js';
import { rank } from './svd.js';
import { polyRoots } from '../pade.js';
import * as C from '../complex.js';

const PADE13 = [
  64764752532480000, 32382376266240000, 7771770303897600, 1187353796428800, 129060195264000,
  10559470521600, 670442572800, 33522128640, 1323241920, 40840800, 960960, 16380, 182, 1,
];
const THETA13 = 5.371920351148152;

/** Matrix exponential e^A (Pade [13/13] with scaling and squaring). */
export function expm(A) {
  A = asMatrix(A);
  if (!A.isSquare) throw new RangeError('expm: square matrix required');
  const n = A.rows;
  if (n === 0) return new Matrix(0, 0);
  if (!A.isFinite()) throw new Error('expm: non-finite entries');
  const nrm = A.norm1();
  const s = nrm > THETA13 ? Math.max(0, Math.ceil(Math.log2(nrm / THETA13))) : 0;
  const As = s ? A.scale(Math.pow(2, -s)) : A;
  const I = Matrix.identity(n), b = PADE13;
  const A2 = As.mul(As), A4 = A2.mul(A2), A6 = A4.mul(A2);
  const U = As.mul(
    A6.mul(A6.scale(b[13]).add(A4.scale(b[11])).add(A2.scale(b[9])))
      .add(A6.scale(b[7])).add(A4.scale(b[5])).add(A2.scale(b[3])).add(I.scale(b[1])));
  const V = A6.mul(A6.scale(b[12]).add(A4.scale(b[10])).add(A2.scale(b[8])))
    .add(A6.scale(b[6])).add(A4.scale(b[4])).add(A2.scale(b[2])).add(I.scale(b[0]));
  let R = luSolve(lu(V.sub(U)), V.add(U));
  for (let i = 0; i < s; i++) R = R.mul(R);
  return R;
}

/** Integral  int_0^t e^{A s} ds  (the "phi_1" matrix times t), via expm of [[A, I],[0, 0]] t. */
export function expmIntegral(A, t = 1) {
  A = asMatrix(A);
  const n = A.rows;
  const M = blocks([[A.scale(t), Matrix.identity(n).scale(t)], [Matrix.zeros(n, n), Matrix.zeros(n, n)]]);
  return expm(M).block(0, n, n, 2 * n);
}

/**
 * Exact zero-order-hold discretisation of x' = A x + B u with sample time dt (Van Loan block trick):
 * expm([[A, B],[0, 0]] dt) = [[Ad, Bd],[0, I]]  =>  x[k+1] = Ad x[k] + Bd u[k].
 * @returns {{Ad: Matrix, Bd: Matrix}}
 */
export function discretize(A, B, dt) {
  A = asMatrix(A); B = asMatrix(B);
  const n = A.rows, m = B.cols;
  const M = blocks([[A.scale(dt), B.scale(dt)], [Matrix.zeros(m, n), Matrix.zeros(m, m)]]);
  const E = expm(M);
  return { Ad: E.block(0, n, 0, n), Bd: E.block(0, n, n, n + m) };
}

/**
 * Van Loan discretisation of continuous process noise: for x' = A x + w, E[w w^T] = Qc delta(t),
 * returns Ad = e^{A dt} and Qd = int_0^dt e^{A s} Qc e^{A^T s} ds.
 */
export function discretizeNoise(A, Qc, dt) {
  A = asMatrix(A); Qc = asMatrix(Qc);
  const n = A.rows;
  const M = blocks([[A.scale(-dt), Qc.scale(dt)], [Matrix.zeros(n, n), A.transpose().scale(dt)]]);
  const E = expm(M);
  const Ad = E.block(n, 2 * n, n, 2 * n).transpose();
  return { Ad, Qd: Ad.mul(E.block(0, n, n, 2 * n)) };
}

/**
 * Apply a scalar function f (complex -> complex, `[re,im] => [re,im]`, e.g. functions of lib/complex.js) to a
 * DIAGONALIZABLE real matrix:  f(A) = V f(D) V^-1.
 * Returns a real Matrix by default (assumes f(conj z) = conj f(z)); `{complex: true}` returns the CMatrix.
 * Result is meaningless for defective matrices (the eigenvector matrix is singular).
 */
export function funm(A, f, { complex = false } = {}) {
  A = asMatrix(A);
  const { values, vectors } = eig(A);
  const n = A.rows, VD = vectors.clone();
  for (let j = 0; j < n; j++) {
    const fz = f(values[j]);
    for (let i = 0; i < n; i++) {
      const r = vectors.re[i * n + j], im = vectors.im[i * n + j];
      VD.re[i * n + j] = r * fz[0] - im * fz[1];
      VD.im[i * n + j] = r * fz[1] + im * fz[0];
    }
  }
  // F = VD V^-1  <=>  F V = VD  <=>  V^T F^T = VD^T ... solve with the conjugate-transpose trick: F = (V^-T VD^T)^T
  const Vt = new CMatrix(n, n), VDt = new CMatrix(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    Vt.re[j * n + i] = vectors.re[i * n + j]; Vt.im[j * n + i] = vectors.im[i * n + j];
    VDt.re[j * n + i] = VD.re[i * n + j]; VDt.im[j * n + i] = VD.im[i * n + j];
  }
  const Xt = Vt.solve(VDt);
  const F = new CMatrix(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { F.re[j * n + i] = Xt.re[i * n + j]; F.im[j * n + i] = Xt.im[i * n + j]; }
  return complex ? F : F.realPart();
}

/** e^A through the eigendecomposition (diagonalizable A only); mainly a cross-check for `expm`. */
export const expmEig = (A) => funm(A, C.exp);

/**
 * Matrix power A^p. Integer p (including negative) uses repeated squaring / inverse and works for any
 * square matrix; non-integer p uses the eigendecomposition (diagonalizable A, principal branch).
 */
export function matrixPower(A, p) {
  A = asMatrix(A);
  if (Number.isInteger(p)) {
    let base = p < 0 ? luSolve(lu(A), Matrix.identity(A.rows)) : A;
    let e = Math.abs(p), R = Matrix.identity(A.rows);
    while (e > 0) { if (e & 1) R = R.mul(base); e = Math.floor(e / 2); if (e) base = base.mul(base); }
    return R;
  }
  return funm(A, (z) => (z[0] === 0 && z[1] === 0 ? [0, 0] : C.pow(z, [p, 0])));
}
/** Principal matrix square root of a diagonalizable matrix. */
export const sqrtm = (A) => matrixPower(A, 0.5);

/** Evaluate the matrix polynomial sum coefs[k] A^(n-k) (coefs HIGHEST power first) by Horner. */
export function polyvalm(coefsHighToLow, A) {
  A = asMatrix(A);
  const I = Matrix.identity(A.rows);
  let R = Matrix.zeros(A.rows, A.rows);
  for (const c of coefsHighToLow) R = R.mul(A).add(I.scale(c));
  return R;
}

/**
 * Characteristic polynomial det(sI - A) by Faddeev-LeVerrier.
 * @returns {number[]} coefficients highest power first: [1, c_{n-1}, ..., c_0].
 */
export function charPoly(A) {
  A = asMatrix(A);
  const n = A.rows, I = Matrix.identity(n), c = new Array(n + 1);
  c[0] = 1;
  let M = Matrix.zeros(n, n);
  for (let k = 1; k <= n; k++) {
    M = A.mul(M).add(I.scale(c[k - 1]));
    c[k] = -A.mul(M).trace() / k;
  }
  return c;
}
/** Roots (complex [re,im]) of a polynomial given HIGHEST power first (wraps lib/pade.js polyRoots). */
export const polyRootsHigh = (coefsHighToLow) => polyRoots(coefsHighToLow.slice().reverse());
/** Eigenvalues as roots of the characteristic polynomial (only sensible for small n; use `eigvals` otherwise). */
export const eigvalsFromCharPoly = (A) => polyRootsHigh(charPoly(A));
/** Build the real polynomial (highest first) with the given complex roots (conjugate-closed set). */
export function polyFromRoots(roots) {
  let p = [[1, 0]];
  for (const r of roots) {
    const z = Array.isArray(r) ? r : [r, 0];
    const q = new Array(p.length + 1).fill(null).map(() => [0, 0]);
    for (let i = 0; i < p.length; i++) {
      q[i] = C.add(q[i], p[i]);
      q[i + 1] = C.sub(q[i + 1], C.mul(p[i], z));
    }
    p = q;
  }
  return p.map((z) => z[0]);
}
/** Companion matrix of the monic-normalised polynomial (coefficients highest first). */
export function companion(coefsHighToLow) {
  const a = coefsHighToLow.map((v) => v / coefsHighToLow[0]), n = a.length - 1;
  const M = Matrix.zeros(n, n);
  for (let j = 0; j < n; j++) M.data[j] = -a[j + 1];
  for (let i = 1; i < n; i++) M.data[i * n + i - 1] = 1;
  return M;
}

/**
 * Jordan structure from ranks of (A - lambda I)^k (intended for the optional 2x2 / 3x3 defective cases, works for
 * any small n). Eigenvalues closer than `clusterTol * (1 + |lambda|)` are merged (defective eigenvalues are
 * computed only to ~eps^(1/m), so the default is loose).
 * @returns {{blocks: Array<{value: number[], algebraic: number, geometric: number, sizes: number[]}>,
 *            diagonalizable: boolean, defective: boolean}}
 *   sizes = Jordan block sizes of that eigenvalue, descending. Complex eigenvalues are handled via their real
 *   2x2 realification only for the multiplicity counts (sizes reported for the complex-conjugate pair's upper member).
 */
export function jordanForm(A, { clusterTol = 1e-5, rankTol = 1e-7 } = {}) {
  A = asMatrix(A);
  const n = A.rows, vals = eigvals(A), groups = [];
  for (const v of vals) {
    const g = groups.find((q) => Math.hypot(q.sum[0] / q.count - v[0], q.sum[1] / q.count - v[1]) <= clusterTol * (1 + Math.hypot(v[0], v[1])));
    if (g) { g.count++; g.sum[0] += v[0]; g.sum[1] += v[1]; } else groups.push({ count: 1, sum: [v[0], v[1]] });
  }
  const out = [];
  const scale = Math.max(1, A.maxAbs());
  for (const g of groups) {
    const lam = [g.sum[0] / g.count, g.sum[1] / g.count];
    if (Math.abs(lam[1]) > clusterTol) { // complex: skip upper-half duplicates, count via 2n real embedding
      if (lam[1] < 0) continue;
      const M = Matrix.zeros(2 * n, 2 * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const a = A.data[i * n + j] - (i === j ? lam[0] : 0), b = i === j ? -lam[1] : 0;
        M.data[i * 2 * n + j] = a; M.data[i * 2 * n + n + j] = -b; M.data[(n + i) * 2 * n + j] = b; M.data[(n + i) * 2 * n + n + j] = a;
      }
      const sizes = blockSizes(M, 2 * n, g.count, scale, rankTol, 2);
      out.push({ value: lam, algebraic: g.count, geometric: sizes.length, sizes });
      continue;
    }
    const M = A.sub(Matrix.identity(n).scale(lam[0]));
    const sizes = blockSizes(M, n, g.count, scale, rankTol);
    out.push({ value: [lam[0], 0], algebraic: g.count, geometric: sizes.length, sizes });
  }
  const diagonalizable = out.every((b) => b.sizes.every((s) => s === 1));
  return { blocks: out, diagonalizable, defective: !diagonalizable };
}

function blockSizes(M, dim, algebraic, scale, rankTol, factor = 1) {
  // nullity(M^k) for k = 1.. until it reaches the algebraic multiplicity
  const nul = [0];
  let P = Matrix.identity(dim);
  for (let k = 1; k <= algebraic; k++) {
    P = P.mul(M);
    nul.push(Math.round((dim - rank(P, rankTol * Math.pow(scale, k))) / factor));
    if (nul[k] >= algebraic) break;
  }
  const geo = nul[1];
  const sizes = [];
  const ge = (k) => (k < nul.length ? nul[k] - nul[k - 1] : 0); // number of blocks of size >= k
  for (let k = nul.length - 1; k >= 1; k--) {
    const cnt = ge(k) - ge(k + 1);
    for (let c = 0; c < cnt; c++) sizes.push(k);
  }
  if (!sizes.length && geo > 0) for (let i = 0; i < geo; i++) sizes.push(1);
  return sizes;
}
