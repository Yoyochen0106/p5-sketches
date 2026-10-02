/**
 * Eigenvalue problems.
 *
 *  hessenberg(A)      A = Q H Q^T, H upper Hessenberg (Householder).
 *  schur(A)           real Schur form A = Q T Q^T, T quasi-upper-triangular (1x1 and 2x2 blocks),
 *                     computed by Hessenberg reduction + Francis implicit double-shift QR (Golub & Van Loan 7.5.1).
 *  eigvals(A)         all eigenvalues of a general real matrix as complex [re, im] pairs.
 *  eig(A)             eigenvalues AND eigenvectors (CMatrix, unit 2-norm columns), obtained from the Schur form by
 *                     converting 2x2 blocks to complex triangular form and back-substitution.
 *  eigSym(A)          symmetric case: cyclic Jacobi, ascending real eigenvalues, ORTHONORMAL real eigenvectors.
 *
 * No balancing is performed, so very badly scaled matrices lose some accuracy.
 */
import { Matrix, CMatrix, asMatrix } from './matrix.js';

const EPS = 2.220446049250313e-16;

/** Hessenberg reduction by Householder reflections. @returns {{H: Matrix, Q: Matrix}} with A = Q H Q^T. */
export function hessenberg(A) {
  A = asMatrix(A);
  if (!A.isSquare) throw new RangeError('hessenberg: square matrix required');
  const n = A.rows, h = A.data.slice(), z = Matrix.identity(n).data;
  hessenbergInPlace(h, z, n);
  return { H: new Matrix(n, n, h), Q: new Matrix(n, n, z) };
}

function hessenbergInPlace(h, z, n) {
  const v = new Float64Array(n);
  for (let k = 0; k < n - 2; k++) {
    let nrm = 0;
    for (let i = k + 1; i < n; i++) nrm += h[i * n + k] * h[i * n + k];
    nrm = Math.sqrt(nrm);
    if (nrm === 0) continue;
    const alpha = h[(k + 1) * n + k] > 0 ? -nrm : nrm;
    for (let i = k + 1; i < n; i++) v[i] = h[i * n + k];
    v[k + 1] -= alpha;
    let vv = 0;
    for (let i = k + 1; i < n; i++) vv += v[i] * v[i];
    if (vv === 0) continue;
    const beta = 2 / vv;
    for (let j = 0; j < n; j++) { // H := P H
      let s = 0;
      for (let i = k + 1; i < n; i++) s += v[i] * h[i * n + j];
      s *= beta;
      for (let i = k + 1; i < n; i++) h[i * n + j] -= s * v[i];
    }
    for (let i = 0; i < n; i++) { // H := H P ; Z := Z P
      let s = 0, t = 0;
      for (let j = k + 1; j < n; j++) { s += h[i * n + j] * v[j]; t += z[i * n + j] * v[j]; }
      s *= beta; t *= beta;
      for (let j = k + 1; j < n; j++) { h[i * n + j] -= s * v[j]; z[i * n + j] -= t * v[j]; }
    }
    for (let i = k + 2; i < n; i++) h[i * n + k] = 0;
  }
}

/** Split a 2x2 diagonal block with real eigenvalues into two 1x1 blocks by a Givens rotation. */
function splitBlock(h, z, n, k) {
  const a = h[k * n + k], b = h[k * n + k + 1], c = h[(k + 1) * n + k], d = h[(k + 1) * n + k + 1];
  if (c === 0) return;
  const p = (a - d) / 2, q2 = p * p + b * c;
  if (q2 < 0) return; // complex pair: keep the block
  const zz = p + (p >= 0 ? 1 : -1) * Math.sqrt(q2);
  const r = Math.hypot(zz, c);
  const cs = zz / r, sn = c / r;
  for (let j = 0; j < n; j++) {
    const t1 = h[k * n + j], t2 = h[(k + 1) * n + j];
    h[k * n + j] = cs * t1 + sn * t2; h[(k + 1) * n + j] = -sn * t1 + cs * t2;
  }
  for (let i = 0; i < n; i++) {
    const t1 = h[i * n + k], t2 = h[i * n + k + 1];
    h[i * n + k] = cs * t1 + sn * t2; h[i * n + k + 1] = -sn * t1 + cs * t2;
    const u1 = z[i * n + k], u2 = z[i * n + k + 1];
    z[i * n + k] = cs * u1 + sn * u2; z[i * n + k + 1] = -sn * u1 + cs * u2;
  }
  h[(k + 1) * n + k] = 0;
}

/** One Francis double-shift sweep on the active window [l, q] (inclusive) of the full matrix h, accumulating into z. */
function francisStep(h, z, n, l, q, iter) {
  const H = (i, j) => h[i * n + j];
  let s = H(q - 1, q - 1) + H(q, q);
  let t = H(q - 1, q - 1) * H(q, q) - H(q - 1, q) * H(q, q - 1);
  if (iter === 10 || iter === 20) { // exceptional shift
    const sh = H(q, q) + 1.5 * (Math.abs(H(q, q - 1)) + Math.abs(H(q - 1, q - 2)));
    s = 2 * sh; t = sh * sh;
  }
  let x = H(l, l) * H(l, l) + H(l, l + 1) * H(l + 1, l) - s * H(l, l) + t;
  let y = H(l + 1, l) * (H(l, l) + H(l + 1, l + 1) - s);
  let zz = H(l + 1, l) * H(l + 2, l + 1);
  const v = [0, 0, 0];
  for (let k = l; k <= q - 1; k++) {
    const three = k <= q - 2;
    if (k > l) {
      x = H(k, k - 1); y = H(k + 1, k - 1);
      zz = three ? H(k + 2, k - 1) : 0;
    }
    const nrm = Math.sqrt(x * x + y * y + (three ? zz * zz : 0));
    if (nrm === 0) continue;
    const alpha = x > 0 ? -nrm : nrm;
    v[0] = x - alpha; v[1] = y; v[2] = three ? zz : 0;
    const beta = 2 / (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    const m = three ? 3 : 2;
    const j0 = Math.max(k - 1, 0);
    for (let j = j0; j < n; j++) {
      let sum = 0;
      for (let r = 0; r < m; r++) sum += v[r] * h[(k + r) * n + j];
      sum *= beta;
      for (let r = 0; r < m; r++) h[(k + r) * n + j] -= sum * v[r];
    }
    const iMax = Math.min(k + 3, q);
    for (let i = 0; i <= iMax; i++) {
      let sum = 0;
      for (let r = 0; r < m; r++) sum += h[i * n + k + r] * v[r];
      sum *= beta;
      for (let r = 0; r < m; r++) h[i * n + k + r] -= sum * v[r];
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let r = 0; r < m; r++) sum += z[i * n + k + r] * v[r];
      sum *= beta;
      for (let r = 0; r < m; r++) z[i * n + k + r] -= sum * v[r];
    }
    if (k > l) { h[(k + 1) * n + k - 1] = 0; if (three) h[(k + 2) * n + k - 1] = 0; }
  }
}

function francis(h, z, n) {
  let norm = 0;
  for (let i = 0; i < n * n; i++) norm = Math.max(norm, Math.abs(h[i]));
  let hi = n - 1, iter = 0;
  while (hi >= 0) {
    let l = hi;
    while (l > 0) {
      const s = Math.abs(h[(l - 1) * n + l - 1]) + Math.abs(h[l * n + l]) || norm;
      if (Math.abs(h[l * n + l - 1]) <= EPS * s) { h[l * n + l - 1] = 0; break; }
      l--;
    }
    if (l === hi) { hi--; iter = 0; continue; }
    if (l === hi - 1) { splitBlock(h, z, n, hi - 1); hi -= 2; iter = 0; continue; }
    if (++iter > 100) throw new Error('eig: QR iteration did not converge');
    francisStep(h, z, n, l, hi, iter);
  }
  for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) h[i * n + j] = 0;
}

/** Eigenvalues [re, im] read off a quasi-triangular real Schur factor. */
function schurEigenvalues(T) {
  const n = T.rows, t = T.data, vals = [];
  for (let i = 0; i < n; i++) {
    if (i < n - 1 && t[(i + 1) * n + i] !== 0) {
      const a = t[i * n + i], b = t[i * n + i + 1], c = t[(i + 1) * n + i], d = t[(i + 1) * n + i + 1];
      const p = (a - d) / 2, q2 = p * p + b * c, m = (a + d) / 2;
      if (q2 < 0) { const w = Math.sqrt(-q2); vals.push([m, w], [m, -w]); }
      else { const w = Math.sqrt(q2); vals.push([m + w, 0], [m - w, 0]); }
      i++;
    } else vals.push([t[i * n + i], 0]);
  }
  return vals;
}

/**
 * Real Schur decomposition A = Q T Q^T (Q orthogonal; T quasi-upper-triangular: real eigenvalues on 1x1 blocks,
 * complex-conjugate pairs on 2x2 blocks with negative off-diagonal product).
 * @returns {{T: Matrix, Q: Matrix, values: number[][]}} values are [re, im] in diagonal order.
 */
export function schur(A) {
  A = asMatrix(A);
  if (!A.isSquare) throw new RangeError('schur: square matrix required');
  const n = A.rows, h = A.data.slice(), z = Matrix.identity(n).data;
  if (!A.isFinite()) throw new Error('schur: non-finite entries');
  hessenbergInPlace(h, z, n);
  if (n > 1) francis(h, z, n);
  const T = new Matrix(n, n, h);
  return { T, Q: new Matrix(n, n, z), values: schurEigenvalues(T) };
}

const byValue = (p, q) => q[0] - p[0] || q[1] - p[1];

/** All eigenvalues of a general real square matrix as [re, im] pairs, sorted by real part descending (then imag descending). */
export function eigvals(A) {
  return schur(A).values.sort(byValue);
}

/**
 * Eigen-decomposition of a general real matrix.
 * @returns {{values: number[][], vectors: CMatrix}} values[k] = [re, im] (sorted by real part desc, then imag desc),
 *   vectors column k = unit-norm eigenvector for values[k] (largest component made real positive, so real
 *   eigenvalues give real vectors). For defective matrices the columns are (nearly) parallel.
 */
export function eig(A) {
  const { T, Q } = schur(A);
  const n = T.rows;
  const tr = T.data.slice(), ti = new Float64Array(n * n), ur = Q.data.slice(), ui = new Float64Array(n * n);
  // 1. Convert 2x2 blocks to complex upper-triangular form with a unitary G = [[v, w]].
  for (let k = 0; k < n - 1; k++) {
    if (tr[(k + 1) * n + k] === 0) continue;
    const a = tr[k * n + k], b = tr[k * n + k + 1], c = tr[(k + 1) * n + k], d = tr[(k + 1) * n + k + 1];
    const lr = (a + d) / 2, li = Math.sqrt(Math.max(0, -((a - d) * (a - d) / 4 + b * c)));
    // candidate eigenvectors (b, lambda - a) and (lambda - d, c); take the larger one
    let v1r = b, v1i = 0, v2r = lr - a, v2i = li;
    if (Math.hypot(lr - d, li, c) > Math.hypot(b, lr - a, li)) { v1r = lr - d; v1i = li; v2r = c; v2i = 0; }
    const nv = Math.hypot(v1r, v1i, v2r, v2i);
    v1r /= nv; v1i /= nv; v2r /= nv; v2i /= nv;
    // G = [[g11 g12],[g21 g22]] = [[v1, -conj v2],[v2, conj v1]]
    const g11r = v1r, g11i = v1i, g21r = v2r, g21i = v2i, g12r = -v2r, g12i = v2i, g22r = v1r, g22i = -v1i;
    for (let j = 0; j < n; j++) { // rows: T := G^H T
      const ar = tr[k * n + j], ai = ti[k * n + j], br = tr[(k + 1) * n + j], bi = ti[(k + 1) * n + j];
      tr[k * n + j] = g11r * ar + g11i * ai + g21r * br + g21i * bi;
      ti[k * n + j] = g11r * ai - g11i * ar + g21r * bi - g21i * br;
      tr[(k + 1) * n + j] = g12r * ar + g12i * ai + g22r * br + g22i * bi;
      ti[(k + 1) * n + j] = g12r * ai - g12i * ar + g22r * bi - g22i * br;
    }
    const colRight = (xr, xi) => {
      for (let i = 0; i < n; i++) {
        const ar = xr[i * n + k], ai = xi[i * n + k], br = xr[i * n + k + 1], bi = xi[i * n + k + 1];
        xr[i * n + k] = ar * g11r - ai * g11i + br * g21r - bi * g21i;
        xi[i * n + k] = ar * g11i + ai * g11r + br * g21i + bi * g21r;
        xr[i * n + k + 1] = ar * g12r - ai * g12i + br * g22r - bi * g22i;
        xi[i * n + k + 1] = ar * g12i + ai * g12r + br * g22i + bi * g22r;
      }
    };
    colRight(tr, ti); colRight(ur, ui);
    tr[(k + 1) * n + k] = 0; ti[(k + 1) * n + k] = 0;
    k++;
  }
  let normT = 0;
  for (let i = 0; i < n * n; i++) normT = Math.max(normT, Math.hypot(tr[i], ti[i]));
  const tiny = Math.max(EPS * normT, 1e-300);
  // 2. Eigenvectors of the triangular factor by back-substitution, then multiply by U.
  const values = [], cols = [];
  const xr = new Float64Array(n), xi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const lr = tr[k * n + k], li = ti[k * n + k];
    xr.fill(0); xi.fill(0); xr[k] = 1;
    for (let i = k - 1; i >= 0; i--) {
      let sr = 0, si = 0;
      for (let j = i + 1; j <= k; j++) {
        const ar = tr[i * n + j], ai = ti[i * n + j];
        sr += ar * xr[j] - ai * xi[j]; si += ar * xi[j] + ai * xr[j];
      }
      let dr = tr[i * n + i] - lr, di = ti[i * n + i] - li;
      if (Math.hypot(dr, di) < tiny) { dr = tiny; di = 0; }
      const dd = dr * dr + di * di;
      xr[i] = -(sr * dr + si * di) / dd; xi[i] = -(si * dr - sr * di) / dd;
    }
    const vr = new Float64Array(n), vi = new Float64Array(n);
    let nrm = 0;
    for (let i = 0; i < n; i++) {
      let sr = 0, si = 0;
      for (let j = 0; j <= k; j++) {
        const ar = ur[i * n + j], ai = ui[i * n + j];
        sr += ar * xr[j] - ai * xi[j]; si += ar * xi[j] + ai * xr[j];
      }
      vr[i] = sr; vi[i] = si; nrm += sr * sr + si * si;
    }
    nrm = Math.sqrt(nrm);
    let big = 0, bi = 0;
    for (let i = 0; i < n; i++) { const m = Math.hypot(vr[i], vi[i]); if (m > big * (1 + 1e-12)) { big = m; bi = i; } }
    // rotate phase so the largest component is real positive, and normalise
    const pr = vr[bi] / big, pi = -vi[bi] / big;
    for (let i = 0; i < n; i++) {
      const a = vr[i] / nrm, b = vi[i] / nrm;
      vr[i] = a * pr - b * pi; vi[i] = a * pi + b * pr;
      if (Math.abs(vi[i]) < 1e-15 && li === 0) vi[i] = 0;
    }
    values.push([lr, li]); cols.push([vr, vi]);
  }
  // snap diagonal imaginary parts of real eigenvalues
  const order = values.map((_, i) => i).sort((p, q) => byValue(values[p], values[q]));
  const V = new CMatrix(n, n);
  order.forEach((src, dst) => {
    for (let i = 0; i < n; i++) { V.re[i * n + dst] = cols[src][0][i]; V.im[i * n + dst] = cols[src][1][i]; }
  });
  return { values: order.map((i) => values[i]), vectors: V };
}

/**
 * Symmetric eigenproblem by cyclic Jacobi rotations.
 * @returns {{values: number[], vectors: Matrix}} eigenvalues ASCENDING; column k of `vectors` is the orthonormal
 *   eigenvector of values[k] (A = V diag(values) V^T). Only the symmetric part of A is used.
 */
export function eigSym(A) {
  A = asMatrix(A);
  if (!A.isSquare) throw new RangeError('eigSym: square matrix required');
  const n = A.rows, a = A.symmetrized().data, v = Matrix.identity(n).data;
  let scale = 0;
  for (let i = 0; i < n * n; i++) scale = Math.max(scale, Math.abs(a[i]));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i * n + j] * a[i * n + j];
    if (Math.sqrt(off) <= 1e-17 * scale * n || off === 0) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) <= 1e-300 || Math.abs(apq) < 1e-18 * scale) { a[p * n + q] = a[q * n + p] = 0; continue; }
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p], akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k], aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk;
        }
        a[p * n + q] = a[q * n + p] = 0;
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p], vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq; v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const d = Array.from({ length: n }, (_, i) => a[i * n + i]);
  const order = d.map((_, i) => i).sort((p, q) => d[p] - d[q]);
  return {
    values: order.map((i) => d[i]),
    vectors: Matrix.fromFunction(n, n, (i, j) => v[i * n + order[j]]),
  };
}
