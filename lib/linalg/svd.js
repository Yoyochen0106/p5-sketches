/**
 * Singular value decomposition (one-sided Hestenes/Jacobi) and everything derived from it:
 * pseudoinverse, rank, condition number, low-rank approximation, null/row/column spaces, polar decomposition.
 */
import { Matrix, asMatrix } from './matrix.js';

const EPS = 2.220446049250313e-16;

/** Extend `cols` (array of orthonormal Float64Array of length m) to `target` orthonormal columns using unit vectors. */
function completeBasis(cols, m, target) {
  let start = 0;
  while (cols.length < target) {
    const need = target - cols.length;
    const thresh = 0.5 * need / m;
    let found = false;
    for (let t = 0; t < m && !found; t++) {
      const i = (start + t) % m;
      const v = new Float64Array(m);
      v[i] = 1;
      for (let pass = 0; pass < 2; pass++) {
        for (const c of cols) {
          let d = 0;
          for (let k = 0; k < m; k++) d += c[k] * v[k];
          for (let k = 0; k < m; k++) v[k] -= d * c[k];
        }
      }
      let nn = 0;
      for (let k = 0; k < m; k++) nn += v[k] * v[k];
      if (nn > thresh) {
        const s = 1 / Math.sqrt(nn);
        for (let k = 0; k < m; k++) v[k] *= s;
        cols.push(v);
        start = i + 1;
        found = true;
      }
    }
    if (!found) throw new Error('svd: could not complete orthonormal basis');
  }
}

/**
 * SVD  A = U diag(S) V^T  with S sorted DESCENDING (all >= 0).
 * Thin (default): U is m x k, V is n x k, k = min(m,n).
 * `{full: true}`: U is m x m, V is n x n (extra columns span the null spaces).
 * Rank-deficient inputs get orthonormal completion columns in U (and V when full).
 * @returns {{U: Matrix, S: number[], V: Matrix}}
 */
export function svd(A, { full = false } = {}) {
  A = asMatrix(A);
  const m = A.rows, n = A.cols;
  if (m < n) {
    const r = svd(A.transpose(), { full });
    return { U: r.V, S: r.S, V: r.U };
  }
  const W = [], V = [];
  for (let j = 0; j < n; j++) {
    W.push(Float64Array.from(A.colVec(j)));
    const e = new Float64Array(n);
    e[j] = 1;
    V.push(e);
  }
  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const wp = W[p], wq = W[q];
        let alpha = 0, beta = 0, gamma = 0;
        for (let i = 0; i < m; i++) { alpha += wp[i] * wp[i]; beta += wq[i] * wq[i]; gamma += wp[i] * wq[i]; }
        if (gamma === 0 || Math.abs(gamma) <= EPS * Math.sqrt(alpha * beta)) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < m; i++) { const a = wp[i], b = wq[i]; wp[i] = c * a - s * b; wq[i] = s * a + c * b; }
        const vp = V[p], vq = V[q];
        for (let i = 0; i < n; i++) { const a = vp[i], b = vq[i]; vp[i] = c * a - s * b; vq[i] = s * a + c * b; }
      }
    }
    if (!rotated) break;
  }
  const sig = W.map((w) => { let s = 0; for (let i = 0; i < m; i++) s += w[i] * w[i]; return Math.sqrt(s); });
  const order = sig.map((_, i) => i).sort((a, b) => sig[b] - sig[a]);
  const S = order.map((i) => sig[i]);
  const smax = S[0] || 0;
  const cut = Math.max(m, n) * EPS * smax * 4;
  const Ucols = [], Vcols = order.map((i) => V[i]);
  const good = [];
  order.forEach((i, k) => {
    if (S[k] > cut && S[k] > 0) {
      const u = new Float64Array(m);
      for (let r = 0; r < m; r++) u[r] = W[i][r] / S[k];
      Ucols[k] = u; good.push(k);
    }
  });
  // Fill rank-deficient columns with an orthonormal completion (keeping column order).
  const basis = good.map((k) => Ucols[k]);
  const missing = [];
  for (let k = 0; k < n; k++) if (!Ucols[k]) missing.push(k);
  if (missing.length) {
    completeBasis(basis, m, good.length + missing.length);
    missing.forEach((k, idx) => { Ucols[k] = basis[good.length + idx]; });
  }
  let Uc = Ucols, Vc = Vcols;
  if (full) {
    Uc = Ucols.slice();
    completeBasis(Uc, m, m);
  }
  const U = Matrix.fromFunction(m, Uc.length, (i, j) => Uc[j][i]);
  const Vm = Matrix.fromFunction(n, Vc.length, (i, j) => Vc[j][i]);
  return { U, S, V: Vm };
}

/** Singular values only (descending). */
export const singularValues = (A) => svd(A).S;

/** Default rank tolerance: max(m,n) * eps * sigma_max. */
function rankTol(A, S) { return Math.max(A.rows, A.cols) * EPS * (S[0] || 0); }

/** Numerical rank (number of singular values above tol; default max(m,n)*eps*sigma_max). */
export function rank(A, tol) {
  A = asMatrix(A);
  const S = svd(A).S;
  const t = tol ?? rankTol(A, S);
  return S.filter((s) => s > t).length;
}
/** Spectral norm ||A||_2 = sigma_max. */
export const norm2Matrix = (A) => (svd(A).S[0] || 0);
/** 2-norm condition number sigma_max / sigma_min (Infinity if singular). */
export function cond(A) {
  A = asMatrix(A);
  const S = svd(A).S;
  if (!S.length) return 1;
  const mn = S[S.length - 1];
  return mn > Math.max(A.rows, A.cols) * EPS * S[0] ? S[0] / mn : Infinity;
}

/** Moore-Penrose pseudoinverse (n x m). */
export function pinv(A, tol) {
  A = asMatrix(A);
  const { U, S, V } = svd(A);
  const t = tol ?? rankTol(A, S);
  const out = new Matrix(A.cols, A.rows);
  for (let k = 0; k < S.length; k++) {
    if (!(S[k] > t)) continue;
    const inv = 1 / S[k];
    for (let i = 0; i < A.cols; i++) {
      const vi = V.data[i * V.cols + k] * inv;
      for (let j = 0; j < A.rows; j++) out.data[i * A.rows + j] += vi * U.data[j * U.cols + k];
    }
  }
  return out;
}

/**
 * Best rank-k approximation (Eckart-Young). Returns the approximation, its factors and the exact
 * 2-norm error sigma_{k+1} (and Frobenius error sqrt(sum_{i>k} sigma_i^2)).
 */
export function lowRank(A, k) {
  A = asMatrix(A);
  const { U, S, V } = svd(A);
  k = Math.max(0, Math.min(k, S.length));
  const out = new Matrix(A.rows, A.cols);
  for (let l = 0; l < k; l++) {
    for (let i = 0; i < A.rows; i++) {
      const u = U.data[i * U.cols + l] * S[l];
      for (let j = 0; j < A.cols; j++) out.data[i * A.cols + j] += u * V.data[j * V.cols + l];
    }
  }
  const tail = S.slice(k);
  return { A: out, U, S, V, k, error2: tail.length ? tail[0] : 0, errorFro: Math.sqrt(tail.reduce((s, x) => s + x * x, 0)) };
}

/** Orthonormal basis of the null space {x : A x = 0} as columns (n x (n - rank)). */
export function nullspace(A, tol) {
  A = asMatrix(A);
  const f = svd(A, { full: true });
  const t = tol ?? rankTol(A, f.S);
  const r = f.S.filter((s) => s > t).length;
  return f.V.block(0, A.cols, r, A.cols);
}
/** Orthonormal basis of the row space as columns (n x rank). */
export function rowspace(A, tol) {
  A = asMatrix(A);
  const f = svd(A), t = tol ?? rankTol(A, f.S), r = f.S.filter((s) => s > t).length;
  return f.V.block(0, A.cols, 0, r);
}
/** Orthonormal basis of the column space (m x rank). */
export function colspace(A, tol) {
  A = asMatrix(A);
  const f = svd(A), t = tol ?? rankTol(A, f.S), r = f.S.filter((s) => s > t).length;
  return f.U.block(0, A.rows, 0, r);
}
/** Orthonormal basis of the left null space {y : A^T y = 0}. */
export const leftNullspace = (A, tol) => nullspace(asMatrix(A).transpose(), tol);

/**
 * Right polar decomposition A = Q P with Q orthogonal (m x n, orthonormal columns) and
 * P = (A^T A)^(1/2) symmetric positive semi-definite (n x n).
 */
export function polar(A) {
  A = asMatrix(A);
  const { U, S, V } = svd(A);
  const Q = U.mul(V.transpose());
  const P = V.mul(Matrix.diag(S)).mul(V.transpose());
  return { Q, P, S };
}
