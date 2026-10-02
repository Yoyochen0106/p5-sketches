/**
 * Closed-form helpers for 2x2 / 3x3 matrices (UI use) and simple iterative / banded solvers.
 * Matrices here may be passed as nested arrays, Matrix instances, or (2x2 only) as four numbers a,b,c,d.
 */
import { Matrix, asMatrix, dot, norm2 } from './matrix.js';

function m2(a, b, c, d) {
  if (b === undefined) {
    const M = asMatrix(a);
    if (M.rows !== 2 || M.cols !== 2) throw new RangeError('expected a 2x2 matrix');
    return M.data;
  }
  return [a, b, c, d];
}

/** 2x2 rotation matrix R(theta) = [[cos, -sin],[sin, cos]]. */
export const rotation2 = (theta) => Matrix.from([[Math.cos(theta), -Math.sin(theta)], [Math.sin(theta), Math.cos(theta)]]);
/** Area scale factor of the linear map: |det A|. */
export function areaScale(A) { const [a, b, c, d] = m2(A); return Math.abs(a * d - b * c); }
export function det2(A) { const [a, b, c, d] = m2(A); return a * d - b * c; }

/**
 * Closed-form eigen-analysis of a 2x2 matrix [[a,b],[c,d]].
 * @returns {{values: number[][], vectors: number[][][], trace, det, discriminant, kind, defective}}
 *   values: two [re, im] (real roots ordered larger first; complex pairs with positive imaginary part first).
 *   vectors[k]: unit eigenvector for values[k] as [[re,im],[re,im]] (for a defective matrix both are the single eigenvector).
 *   discriminant = trace^2 - 4 det.  kind: 'real' | 'repeated' | 'complex'.
 */
export function eig2x2(a, b, c, d) {
  [a, b, c, d] = m2(a, b, c, d);
  const tr = a + d, dt = a * d - b * c, disc = tr * tr - 4 * dt;
  const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  let values, kind;
  const repeatedTol = 1e-14 * scale * scale;
  if (Math.abs(disc) <= repeatedTol) { values = [[tr / 2, 0], [tr / 2, 0]]; kind = 'repeated'; }
  else if (disc > 0) {
    const s = Math.sqrt(disc), q = tr >= 0 ? (tr + s) / 2 : (tr - s) / 2;
    // stable roots: q and dt/q
    const l1 = q, l2 = q !== 0 ? dt / q : 0;
    values = [[Math.max(l1, l2), 0], [Math.min(l1, l2), 0]]; kind = 'real';
  } else { const s = Math.sqrt(-disc) / 2; values = [[tr / 2, s], [tr / 2, -s]]; kind = 'complex'; }
  const vec = (lr, li) => {
    // (b, lambda - a) or (lambda - d, c), whichever is larger
    let x = [b, 0], y = [lr - a, li];
    const alt = [lr - d, li], altY = [c, 0];
    if (Math.hypot(alt[0], alt[1], altY[0]) > Math.hypot(x[0], y[0], y[1])) { x = alt; y = altY; }
    const n = Math.hypot(x[0], x[1], y[0], y[1]);
    if (n < 1e-300) return null;
    return [[x[0] / n, x[1] / n], [y[0] / n, y[1] / n]];
  };
  let vectors;
  const isScalar = b === 0 && c === 0 && a === d;
  if (isScalar) vectors = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
  else if (b === 0 && c === 0) vectors = values.map((v) => (Math.abs(v[0] - a) <= Math.abs(v[0] - d) ? [[1, 0], [0, 0]] : [[0, 0], [1, 0]]));
  else vectors = values.map((v) => vec(v[0], v[1]));
  const defective = kind === 'repeated' && !isScalar;
  return { values, vectors, trace: tr, det: dt, discriminant: disc, kind, defective };
}

/**
 * Phase-portrait classification of x' = A x for a 2x2 matrix.
 * @returns {string} one of 'stable node', 'unstable node', 'saddle', 'stable spiral', 'unstable spiral', 'center',
 *   'stable degenerate node', 'unstable degenerate node', 'stable star', 'unstable star', 'line of equilibria', 'origin (zero matrix)'.
 */
export function classify2x2(a, b, c, d) {
  const e = eig2x2(a, b, c, d), tr = e.trace, dt = e.det, eps = 1e-12;
  const [l1, l2] = e.values;
  if (e.kind === 'complex') return Math.abs(l1[0]) <= eps * Math.max(1, Math.abs(l1[1])) ? 'center' : l1[0] < 0 ? 'stable spiral' : 'unstable spiral';
  if (Math.abs(dt) <= eps * Math.max(1, tr * tr)) {
    if (Math.abs(tr) <= eps && e.vectors) return Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(d) === 0 ? 'origin (zero matrix)' : 'line of equilibria';
    return 'line of equilibria';
  }
  if (e.kind === 'repeated') {
    const side = l1[0] < 0 ? 'stable' : 'unstable';
    return e.defective ? `${side} degenerate node` : `${side} star`;
  }
  if (l1[0] * l2[0] < 0) return 'saddle';
  return l1[0] < 0 ? 'stable node' : 'unstable node';
}

/**
 * Closed-form SVD of a 2x2 matrix in terms of rotation angles:
 *   A = R(angleU) diag(s1, sgn*s2) R(angleV)^T,   s1 >= s2 >= 0,  sgn = +1 if det >= 0 else -1.
 * (A reflection, when det < 0, is absorbed into the sign of the second singular direction.)
 * Uses the Blinn decomposition with E=(a+d)/2, F=(a-d)/2, G=(c+b)/2, H=(c-b)/2.
 * @returns {{s1:number, s2:number, angleU:number, angleV:number, sign:number, U:Matrix, V:Matrix, det:number}}
 *   U = R(angleU), V = R(angleV); then A = U diag(s1, sign*s2) V^T. s1 s2 = |det|; the unit circle maps to an
 *   ellipse with semi-axes s1, s2 along the columns of U.
 */
export function svd2x2(a, b, c, d) {
  [a, b, c, d] = m2(a, b, c, d);
  const E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2;
  const Q = Math.hypot(E, H), R = Math.hypot(F, G);
  const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
  const theta = (a2 - a1) / 2, phi = (a2 + a1) / 2;
  const s1 = Q + R, s2s = Q - R;
  return { s1, s2: Math.abs(s2s), angleU: phi, angleV: -theta, sign: s2s >= 0 ? 1 : -1, U: rotation2(phi), V: rotation2(-theta), det: a * d - b * c };
}

/**
 * Polar decomposition A = Q P of a 2x2 matrix: Q is the closest orthogonal matrix, P symmetric PSD.
 * det >= 0: Q = R(angle) is a rotation, angle = atan2(c - b, a + d).
 * det < 0:  Q = [[cos t, sin t],[sin t, -cos t]] is a reflection, angle = t = atan2(c + b, a - d).
 * @returns {{Q: Matrix, P: Matrix, angle: number, reflection: boolean, stretches: number[]}} stretches = singular values.
 */
export function polar2x2(a, b, c, d) {
  [a, b, c, d] = m2(a, b, c, d);
  const dt = a * d - b * c;
  // closest orthogonal matrix: rotation uses (a+d, c-b); reflection uses (a-d, c+b)
  let Q;
  let angle;
  const reflection = dt < 0;
  if (!reflection) { angle = Math.atan2(c - b, a + d); Q = rotation2(angle); }
  else { angle = Math.atan2(c + b, a - d); const cs = Math.cos(angle), sn = Math.sin(angle); Q = Matrix.from([[cs, sn], [sn, -cs]]); }
  const P = Q.transpose().mul(Matrix.from([[a, b], [c, d]])).symmetrized();
  const s = svd2x2(a, b, c, d);
  return { Q, P, angle, reflection, stretches: [s.s1, s.s2] };
}

/** Determinant of a 3x3 matrix. */
export function det3(A) {
  const m = asMatrix(A).data;
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}
/** Inverse of a 3x3 matrix via the adjugate (throws if singular). */
export function inv3(A) {
  const m = asMatrix(A).data, dt = det3(A);
  if (dt === 0) throw new Error('inv3: singular matrix');
  const c = (i, j, k, l) => m[i * 3 + j] * m[k * 3 + l] - m[i * 3 + l] * m[k * 3 + j];
  return Matrix.from([
    [c(1, 1, 2, 2) / dt, -c(0, 1, 2, 2) / dt, c(0, 1, 1, 2) / dt],
    [-c(1, 0, 2, 2) / dt, c(0, 0, 2, 2) / dt, -c(0, 0, 1, 2) / dt],
    [c(1, 0, 2, 1) / dt, -c(0, 0, 2, 1) / dt, c(0, 0, 1, 1) / dt],
  ]);
}
/** Cross product of two 3-vectors. */
export const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

/** Eigenvalues of a symmetric 3x3 matrix in closed form (trigonometric solution), ascending. */
export function eigSym3Values(A) {
  const m = asMatrix(A).data;
  const p1 = m[1] * m[1] + m[2] * m[2] + m[5] * m[5];
  const q = (m[0] + m[4] + m[8]) / 3;
  if (p1 === 0) return [m[0], m[4], m[8]].sort((x, y) => x - y);
  const p2 = (m[0] - q) ** 2 + (m[4] - q) ** 2 + (m[8] - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const B = m.map((v, i) => (i % 4 === 0 ? v - q : v) / p);
  const r = Math.max(-1, Math.min(1, det3(Matrix.from([[B[0], B[1], B[2]], [B[3], B[4], B[5]], [B[6], B[7], B[8]]])) / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return [e3, 3 * q - e1 - e3, e1];
}

/**
 * Thomas algorithm for a tridiagonal system. sub[i] multiplies x[i-1] in row i (sub[0] unused),
 * diag[i] multiplies x[i], sup[i] multiplies x[i+1] (sup[n-1] unused). No pivoting: needs diagonal dominance / SPD.
 * @returns {number[]} x
 */
export function solveTridiagonal(sub, diag, sup, rhs) {
  const n = diag.length;
  const cp = new Float64Array(n), dp = new Float64Array(n), x = new Array(n);
  if (n === 0) return [];
  if (diag[0] === 0) throw new Error('solveTridiagonal: zero pivot');
  cp[0] = sup[0] / diag[0]; dp[0] = rhs[0] / diag[0];
  for (let i = 1; i < n; i++) {
    const den = diag[i] - sub[i] * cp[i - 1];
    if (den === 0) throw new Error('solveTridiagonal: zero pivot');
    cp[i] = i < n - 1 ? sup[i] / den : 0;
    dp[i] = (rhs[i] - sub[i] * dp[i - 1]) / den;
  }
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}
/** Periodic (cyclic) tridiagonal solve: also sub[0] = A[0][n-1] and sup[n-1] = A[n-1][0]. Sherman-Morrison on Thomas. */
export function solveCyclicTridiagonal(sub, diag, sup, rhs) {
  const n = diag.length;
  if (n < 3) throw new RangeError('solveCyclicTridiagonal: n >= 3 required');
  const alpha = sup[n - 1], beta = sub[0];
  const gamma = -diag[0];
  const d = Array.from(diag), s = Array.from(sub);
  d[0] = diag[0] - gamma; d[n - 1] = diag[n - 1] - (alpha * beta) / gamma;
  s[0] = 0;
  const sp = Array.from(sup); sp[n - 1] = 0;
  const x = solveTridiagonal(s, d, sp, rhs);
  const u = new Array(n).fill(0); u[0] = gamma; u[n - 1] = alpha;
  const z = solveTridiagonal(s, d, sp, u);
  const fact = (x[0] + (beta * x[n - 1]) / gamma) / (1 + z[0] + (beta * z[n - 1]) / gamma);
  return x.map((v, i) => v - fact * z[i]);
}

/**
 * Conjugate gradient for symmetric positive definite systems A x = b.
 * @param {Matrix|number[][]|((x:number[])=>number[])} A matrix or a function computing A x
 * @param {{x0?: number[], tol?: number, maxIter?: number, precondition?: boolean}} [opts] tol on ||r||/||b||;
 *   precondition: Jacobi (diagonal) preconditioner (matrix input only).
 * @returns {{x: number[], iterations: number, residual: number, converged: boolean, history: number[]}} history = ||r_k||/||b||
 */
export function conjugateGradient(A, b, { x0, tol = 1e-10, maxIter, precondition = false } = {}) {
  const n = b.length;
  const matvec = typeof A === 'function' ? A : ((M) => (x) => M.matvec(x))(asMatrix(A));
  let dinv = null;
  if (precondition && typeof A !== 'function') { const M = asMatrix(A); dinv = M.diagVec().map((v) => (v !== 0 ? 1 / v : 1)); }
  const x = x0 ? Array.from(x0) : new Array(n).fill(0);
  const Ax = matvec(x);
  const r = Array.from(b, (v, i) => v - Ax[i]);
  const bn = norm2(b) || 1;
  const z = dinv ? r.map((v, i) => v * dinv[i]) : r.slice();
  const p = z.slice();
  let rz = dot(r, z);
  const history = [norm2(r) / bn];
  const limit = maxIter ?? 10 * n + 10;
  let it = 0;
  while (history[history.length - 1] > tol && it < limit) {
    const Ap = matvec(p);
    const pAp = dot(p, Ap);
    if (!(pAp > 0)) break; // not positive definite (or breakdown)
    const a = rz / pAp;
    for (let i = 0; i < n; i++) { x[i] += a * p[i]; r[i] -= a * Ap[i]; }
    for (let i = 0; i < n; i++) z[i] = dinv ? r[i] * dinv[i] : r[i];
    const rzNew = dot(r, z);
    const bt = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + bt * p[i];
    it++;
    history.push(norm2(r) / bn);
  }
  const residual = history[history.length - 1];
  return { x, iterations: it, residual, converged: residual <= tol, history };
}
