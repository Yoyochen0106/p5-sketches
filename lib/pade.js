// Pade approximants [L/M] from Taylor coefficients, rational evaluation and polynomial roots.
// Complex numbers are [re, im]; polynomial coefficient arrays are lowest degree first.
import * as C from './complex.js';
import { hornerComplex, hornerReal } from './poly.js';

const cx = (c) => (Array.isArray(c) ? c : [c, 0]);

/** Solve the dense complex system A x = b (A is m x m) with partial pivoting; null if singular. */
function solveComplex(A, b, relTol = 1e-13) {
  const m = b.length;
  let scaleMax = 0;
  for (const row of A) for (const v of row) scaleMax = Math.max(scaleMax, C.abs(v));
  if (scaleMax === 0) return null;
  const M = A.map((row, i) => [...row.map((v) => v.slice()), b[i].slice()]);
  for (let col = 0; col < m; col++) {
    let piv = col;
    let best = C.abs(M[col][col]);
    for (let r = col + 1; r < m; r++) {
      const v = C.abs(M[r][col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best <= relTol * scaleMax) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < m; r++) {
      const f = C.div(M[r][col], M[col][col]);
      if (f[0] === 0 && f[1] === 0) continue;
      for (let c2 = col; c2 <= m; c2++) M[r][c2] = C.sub(M[r][c2], C.mul(f, M[col][c2]));
    }
  }
  const x = new Array(m);
  for (let r = m - 1; r >= 0; r--) {
    let acc = M[r][m];
    for (let c2 = r + 1; c2 < m; c2++) acc = C.sub(acc, C.mul(M[r][c2], x[c2]));
    x[r] = C.div(acc, M[r][r]);
  }
  return x;
}

/**
 * Pade approximant [L/M] of the series sum coefs[k] z^k:  num(z)/den(z), deg num <= L, deg den <= M,
 * den[0] = 1, and num/den - series = O(z^(L+M+1)). Needs coefs.length >= L+M+1.
 * If the Toeplitz system is singular, M is reduced until it is solvable; the returned `M` is the
 * degree actually used (M = 0 gives the Taylor polynomial).
 */
export function pade(coefs, L, M) {
  const c = coefs.map(cx);
  if (c.length < L + M + 1) throw new RangeError(`pade needs at least ${L + M + 1} coefficients`);
  const coef = (i) => (i < 0 ? [0, 0] : c[i]);
  let m = M;
  let q = [[1, 0]];
  while (m > 0) {
    // sum_{j=1..m} c_{k-j} q_j = -c_k  for k = L+1..L+m
    const A = [];
    const rhs = [];
    for (let k = L + 1; k <= L + m; k++) {
      A.push(Array.from({ length: m }, (_, j) => coef(k - (j + 1))));
      rhs.push(C.neg(coef(k)));
    }
    const sol = solveComplex(A, rhs);
    if (sol) { q = [[1, 0], ...sol]; break; }
    m--;
  }
  if (m === 0) q = [[1, 0]];
  const num = [];
  for (let k = 0; k <= L; k++) {
    let acc = [0, 0];
    for (let j = 0; j <= Math.min(k, m); j++) acc = C.add(acc, C.mul(q[j], coef(k - j)));
    num.push(acc);
  }
  return { num, den: q, L, M: m };
}

/** Evaluate a rational r = {num, den} at complex dz (distance from the expansion center). */
export function evalRational(r, dz) {
  const z = cx(dz);
  return C.div(hornerComplex(r.num, z), hornerComplex(r.den, z));
}

/** Evaluate a rational at real dx; returns a number. */
export function evalRationalReal(r, dx) {
  return hornerReal(r.num, dx) / hornerReal(r.den, dx);
}

/**
 * All complex roots of the polynomial sum coefs[k] z^k (Aberth-Ehrlich iteration). Negligible
 * leading coefficients are dropped; trailing zero coefficients give exact roots at 0.
 */
export function polyRoots(coefsLowToHigh) {
  let p = coefsLowToHigh.map(cx);
  const mx = Math.max(0, ...p.map(C.abs));
  if (mx === 0) return [];
  while (p.length > 1 && C.abs(p[p.length - 1]) <= 1e-14 * mx) p = p.slice(0, -1);
  const roots = [];
  let lowZero = 0;
  while (p.length > 1 && C.abs(p[0]) <= 1e-14 * mx) { p = p.slice(1); lowZero++; }
  for (let i = 0; i < lowZero; i++) roots.push([0, 0]);
  const n = p.length - 1;
  if (n < 1) return roots;
  if (n === 1) {
    roots.push(C.neg(C.div(p[0], p[1])));
    return roots;
  }
  const dp = p.slice(1).map((v, k) => C.scale(v, k + 1));
  // Initial guesses on a circle of radius ~ geometric mean of root moduli.
  const rad = Math.pow(C.abs(p[0]) / C.abs(p[n]), 1 / n) || 1;
  let z = Array.from({ length: n }, (_, k) => C.fromPolar(rad, (2 * Math.PI * k) / n + 0.4));
  for (let it = 0; it < 500; it++) {
    let maxStep = 0;
    for (let i = 0; i < n; i++) {
      const pv = hornerComplex(p, z[i]);
      if (pv[0] === 0 && pv[1] === 0) continue;
      const dv = hornerComplex(dp, z[i]);
      const ratio = C.div(pv, dv); // Newton step
      let s = [0, 0];
      for (let j = 0; j < n; j++) {
        if (j !== i) s = C.add(s, C.div(C.ONE, C.sub(z[i], z[j])));
      }
      const w = C.div(ratio, C.sub(C.ONE, C.mul(ratio, s)));
      if (!Number.isFinite(w[0]) || !Number.isFinite(w[1])) continue;
      z[i] = C.sub(z[i], w);
      maxStep = Math.max(maxStep, C.abs(w) / Math.max(1e-300, C.abs(z[i])));
    }
    if (maxStep < 1e-15) break;
  }
  return roots.concat(z);
}

/** Poles of the rational (roots of den) in dz coordinates (relative to the expansion center). */
export const poles = (r) => polyRoots(r.den);
/** Zeros of the rational (roots of num) in dz coordinates. */
export const zeros = (r) => polyRoots(r.num);
