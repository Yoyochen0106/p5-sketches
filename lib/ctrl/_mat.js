/**
 * INTERNAL helpers for lib/ctrl/*: tiny dense-matrix routines (matrices are arrays of row arrays,
 * intended for n <= ~10). NOT part of the public API and not re-exported from the barrel; the full-featured
 * matrix library lives in lib/linalg.js. Everything here favours clarity over speed.
 */
import { polyRoots as polyRootsLow } from '../pade.js';

export const mzeros = (r, c = r) => Array.from({ length: r }, () => new Array(c).fill(0));
export const meye = (n) => { const I = mzeros(n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; };
export const mclone = (A) => A.map((r) => r.slice());
export const mT = (A) => (A.length ? A[0].map((_, j) => A.map((r) => r[j])) : []);
export const mAdd = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));
export const mSub = (A, B) => A.map((r, i) => r.map((v, j) => v - B[i][j]));
export const mScale = (A, s) => A.map((r) => r.map((v) => v * s));
export function mMul(A, B) {
  const n = A.length, m = B[0].length, k = B.length;
  const C = mzeros(n, m);
  for (let i = 0; i < n; i++) for (let l = 0; l < k; l++) {
    const a = A[i][l];
    if (a !== 0) for (let j = 0; j < m; j++) C[i][j] += a * B[l][j];
  }
  return C;
}
export const mVec = (A, v) => A.map((r) => { let s = 0; for (let j = 0; j < r.length; j++) s += r[j] * v[j]; return s; });
export const mNorm1 = (A) => (A.length ? Math.max(0, ...A[0].map((_, j) => A.reduce((s, r) => s + Math.abs(r[j]), 0))) : 0);

/** Matrix exponential by scaling and squaring with a Taylor series (accurate to ~1e-15 for small n). */
export function expm(A) {
  const n = A.length;
  const nrm = mNorm1(A);
  let sq = 0;
  if (nrm > 0.5) sq = Math.max(0, Math.ceil(Math.log2(nrm / 0.5)));
  const As = mScale(A, 1 / 2 ** sq);
  let term = meye(n), sum = meye(n);
  for (let k = 1; k <= 20; k++) {
    term = mScale(mMul(term, As), 1 / k);
    sum = mAdd(sum, term);
  }
  for (let i = 0; i < sq; i++) sum = mMul(sum, sum);
  return sum;
}

/** Solve A X = B (B matrix) by Gauss-Jordan elimination with partial pivoting; throws if singular. */
export function msolve(A, B) {
  const n = A.length;
  const M = A.map((r, i) => r.concat(B[i]));
  const scale = Math.max(1e-300, ...A.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14 * scale) throw new Error('singular matrix');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f !== 0) for (let j = c; j < M[r].length; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r, i) => r.slice(n).map((v) => v / M[i][i]));
}
export const minv = (A) => msolve(A, meye(A.length));

/** Determinant by LU (partial pivoting). */
export function mdet(A) {
  const n = A.length;
  const M = mclone(A);
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return 0;
    if (p !== c) { [M[c], M[p]] = [M[p], M[c]]; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j < n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return d;
}

/**
 * Characteristic polynomial det(sI - A) as coefficients highest power first [1, c1, ..., cn]
 * (Faddeev-LeVerrier; fine for n <= ~8). With withAdj, also returns adj[k] = M_k, where
 * adj(sI - A) = sum_k s^(n-1-k) M_k.
 */
export function charPoly(A, withAdj = false) {
  const n = A.length;
  const c = [1];
  let M = meye(n);
  const adj = [M];
  for (let k = 1; k <= n; k++) {
    const AM = mMul(A, M);
    let tr = 0;
    for (let i = 0; i < n; i++) tr += AM[i][i];
    const ck = -tr / k;
    c.push(ck);
    M = AM.map((r, i) => r.map((v, j) => v + (i === j ? ck : 0)));
    if (k < n) adj.push(M);
  }
  return withAdj ? { c, adj } : c;
}

/** Complex roots [re,im] of a real/complex polynomial given highest power first. */
export function rootsHF(p) {
  return polyRootsLow(p.slice().reverse());
}

/** Eigenvalues of a small real matrix as [re,im] pairs (roots of the characteristic polynomial). */
export const eigvals = (A) => (A.length ? rootsHF(charPoly(A)) : []);

/**
 * Exact zero-order-hold discretisation of x' = A x + B u over step dt (B may have several columns).
 * Returns {Ad, Bd} from the exponential of [[A, B],[0, 0]] dt.
 */
export function zohMatrices(A, B, dt) {
  const n = A.length, m = B[0].length;
  const M = mzeros(n + m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = A[i][j] * dt;
    for (let j = 0; j < m; j++) M[i][n + j] = B[i][j] * dt;
  }
  const E = expm(M);
  return {
    Ad: E.slice(0, n).map((r) => r.slice(0, n)),
    Bd: E.slice(0, n).map((r) => r.slice(n)),
  };
}

/**
 * First-order-hold (piecewise-linear input) discretisation, exact for ramps and sines sampled finely:
 * x[k+1] = Ad x[k] + G0 u[k] + G1 (u[k+1] - u[k]) / dt.
 */
export function folMatrices(A, B, dt) {
  const n = A.length, m = B[0].length;
  const N = n + 2 * m;
  const M = mzeros(N);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = A[i][j] * dt;
    for (let j = 0; j < m; j++) M[i][n + j] = B[i][j] * dt;
  }
  for (let j = 0; j < m; j++) M[n + j][n + m + j] = dt;
  const E = expm(M);
  const sub = (c0, w) => E.slice(0, n).map((r) => r.slice(c0, c0 + w));
  return { Ad: sub(0, n), G0: sub(n, m), G1: sub(n + m, m) };
}
