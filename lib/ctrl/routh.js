/**
 * Routh-Hurwitz stability criterion.
 *
 *  - routhArray(p): the Routh table of a characteristic polynomial (highest power first) with the two special cases
 *      * a zero in the first column (replaced by a tiny epsilon, flagged),
 *      * an entire row of zeros (auxiliary polynomial A(s) from the row above; its derivative replaces the row,
 *        A(s)'s roots are symmetric about the origin and include the roots on the jw axis).
 *    It reports sign changes (= number of RHP roots), the number of jw-axis roots and the number of LHP roots.
 *  - stabilityRangeK(num, den): exact set of gains K for which den(s) + K num(s) is Hurwitz, found from the
 *    jw-axis crossings (where a root changes half plane), then one stability test per K interval.
 */
import { polyTrim, polyAdd, polyScale, polyRoots } from './tf.js';

/**
 * Routh table. Returns
 * { rows, firstColumn, signChanges, rhp, lhp, imag, stable, marginal, zeroInFirstColumn, zeroRow, auxiliary, n }
 *  - rows[i] is row s^(n-i) (padded with zeros to equal length),
 *  - rhp = RHP roots, imag = roots on the imaginary axis (from the auxiliary polynomial), lhp = the rest,
 *  - stable = strictly Hurwitz (no RHP and no jw roots), marginal = no RHP but some jw roots,
 *  - auxiliary = list of the auxiliary polynomials used (highest power first).
 */
export function routhArray(p) {
  p = polyTrim(p);
  const n = p.length - 1;
  const out = { n, rows: [], firstColumn: [], signChanges: 0, rhp: 0, lhp: 0, imag: 0, stable: false, marginal: false,
    zeroInFirstColumn: false, zeroRow: false, auxiliary: [] };
  if (n < 1) { out.rows = [p.slice()]; out.firstColumn = [p[0]]; out.stable = p[0] !== 0; out.lhp = 0; return out; }
  const w = Math.ceil((n + 1) / 2);
  const scale = Math.max(...p.map(Math.abs)) || 1;
  const eps = 1e-9 * scale;
  const pad = (a) => { const r = a.slice(); while (r.length < w) r.push(0); return r; };
  const r0 = [], r1 = [];
  for (let i = 0; i <= n; i += 2) r0.push(p[i]);
  for (let i = 1; i <= n; i += 2) r1.push(p[i]);
  const rows = [pad(r0), pad(r1)];
  const epsRows = new Set();
  const auxAt = []; // {row, degree}
  for (let i = 2; i <= n; i++) {
    const a = rows[i - 2], b = rows[i - 1];
    const rowScale = Math.max(...b.map(Math.abs), ...a.map(Math.abs));
    // Row of zeros?
    if (b.every((v) => Math.abs(v) <= 1e-12 * Math.max(rowScale, scale))) {
      // Auxiliary polynomial from the row above (order s^(n-(i-2))), powers decrease by 2.
      const deg = n - (i - 2);
      const aux = new Array(deg + 1).fill(0);
      for (let k = 0; k < w && 2 * k <= deg; k++) aux[2 * k] = a[k];
      const auxP = polyTrim(aux);
      out.zeroRow = true;
      out.auxiliary.push(auxP);
      auxAt.push({ row: i - 2, degree: deg });
      // derivative of A(s): coefficient a[k] * (deg - 2k) at power deg-2k-1 -> new row entries
      const nb = a.map((v, k) => v * (deg - 2 * k));
      rows[i - 1] = pad(nb.filter((_, k) => deg - 2 * k > 0));
    }
    const bb = rows[i - 1];
    let b0 = bb[0];
    if (Math.abs(b0) <= 1e-12 * Math.max(scale, rowScale)) {
      out.zeroInFirstColumn = true;
      epsRows.add(i - 1);
      b0 = eps;
      bb[0] = eps;
    }
    const next = [];
    for (let k = 0; k < w - 1; k++) next.push((bb[0] * a[k + 1] - a[0] * bb[k + 1]) / bb[0]);
    next.push(0);
    rows.push(pad(next));
  }
  // Rows beyond what exists (length n+1 total)
  while (rows.length > n + 1) rows.pop();
  out.rows = rows;
  out.firstColumn = rows.map((r) => r[0]);
  const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const fc = out.firstColumn.map(sgn);
  const changesFrom = (start) => {
    let c = 0, last = 0;
    for (let i = start; i < fc.length; i++) {
      if (fc[i] === 0) continue;
      if (last !== 0 && fc[i] !== last) c++;
      last = fc[i];
    }
    return c;
  };
  out.signChanges = changesFrom(0);
  out.rhp = out.signChanges;
  let imag = 0;
  for (const { row, degree } of auxAt) imag += degree - 2 * changesFrom(row);
  out.imag = Math.max(0, imag);
  // If an auxiliary polynomial has no sign information (odd degree is impossible: even), keep counts consistent.
  out.lhp = Math.max(0, n - out.rhp - out.imag);
  out.stable = out.rhp === 0 && out.imag === 0 && !out.firstColumn.some((v) => v === 0);
  out.marginal = out.rhp === 0 && out.imag > 0;
  if (out.zeroInFirstColumn && out.rhp === 0 && !out.zeroRow) {
    // epsilon rows without sign change would mean roots on the axis; treat as marginal
    out.stable = false;
    out.marginal = true;
  }
  return out;
}

/** Number of roots in the open right half plane according to the Routh table. */
export const routhRhpCount = (p) => routhArray(p).rhp;

/** Is the polynomial (highest power first) Hurwitz-stable according to Routh? */
export const routhStable = (p) => routhArray(p).stable;

/** Characteristic polynomial D(s) + K N(s) for given K (highest power first). */
export function charPolyK(num, den, K) {
  return polyAdd(den, polyScale(num, K));
}

/** Evaluate a polynomial on the imaginary axis: returns {re(w), im(w)} coefficient arrays (low power first in w). */
function jwParts(p) {
  const n = p.length - 1;
  const re = [], im = [];
  for (let i = 0; i <= n; i++) {
    const k = n - i; // power of s
    const c = p[i];
    const ph = k % 4; // j^k
    const target = k; // power of w
    const arr = ph % 2 === 0 ? re : im;
    const sign = ph === 0 || ph === 1 ? 1 : -1;
    while (arr.length <= target) arr.push(0);
    arr[target] += sign * c;
  }
  return { re, im };
}
const trimLow = (a) => { const r = a.slice(); while (r.length > 1 && r[r.length - 1] === 0) r.pop(); return r; };

/**
 * Imaginary-axis crossings of the root locus of 1 + K N(s)/D(s) = 0 (all real K, both signs): the values K where
 * D(jw) + K N(jw) = 0 for some w >= 0. Returns [{K, w}] sorted by K (w = 0 marks a real root crossing the origin).
 * Equivalent to finding the gains where the Routh table acquires a row of zeros / a zero in the first column.
 */
export function jwCrossingsK(num, den) {
  const D = jwParts(den), N = jwParts(num);
  // cross(w) = Dr*Ni - Di*Nr = 0  (K eliminated); polynomials in w, low power first
  const mulLow = (a, b) => {
    const o = new Array(a.length + b.length - 1).fill(0);
    a.forEach((x, i) => b.forEach((y, j) => { o[i + j] += x * y; }));
    return o;
  };
  const sub = (a, b) => { const n = Math.max(a.length, b.length); const o = new Array(n).fill(0); a.forEach((x, i) => { o[i] += x; }); b.forEach((x, i) => { o[i] -= x; }); return o; };
  const e = (a) => (a.length ? a : [0]);
  const cross = trimLow(sub(mulLow(e(D.re), e(N.im)), mulLow(e(D.im), e(N.re))));
  const ws = new Set([0]);
  const hf = cross.slice().reverse();
  if (hf.length > 1 && hf.some((c) => c !== 0)) {
    const scaleC = Math.max(...hf.map(Math.abs));
    for (const r of polyRoots(hf.map((c) => (Math.abs(c) < 1e-14 * scaleC ? 0 : c)))) {
      if (r[0] > 1e-9 && Math.abs(r[1]) <= 1e-6 * Math.max(1, Math.abs(r[0]))) ws.add(r[0]);
    }
  }
  const res = [];
  const evalLow = (a, w) => { let s = 0; for (let i = a.length - 1; i >= 0; i--) s = s * w + a[i]; return s; };
  for (const w of ws) {
    const dr = evalLow(D.re, w), di = evalLow(D.im, w), nr = evalLow(N.re, w), ni = evalLow(N.im, w);
    // solve dr + K nr = 0 and di + K ni = 0 in the least-squares sense when both are informative
    let K = NaN;
    const mag = Math.hypot(nr, ni), dmag = Math.hypot(dr, di);
    if (mag > 1e-12 * Math.max(1, dmag)) {
      K = -(dr * nr + di * ni) / (nr * nr + ni * ni);
      const resid = Math.hypot(dr + K * nr, di + K * ni);
      if (resid > 1e-6 * Math.max(1, dmag)) K = NaN;
    }
    if (Number.isFinite(K)) res.push({ K, w });
  }
  res.sort((a, b) => a.K - b.K || a.w - b.w);
  // dedupe
  return res.filter((r, i) => i === 0 || Math.abs(r.K - res[i - 1].K) > 1e-9 * Math.max(1, Math.abs(r.K)) || Math.abs(r.w - res[i - 1].w) > 1e-9);
}

/**
 * Parametric stability: all K for which den + K num has every root in the open LHP.
 * Returns {intervals: [[lo, hi], ...] (lo/hi may be +-Infinity), critical: [{K, w}], kMax} where kMax is the largest
 * finite upper edge of the interval containing small positive K (the usual "critical gain"), or Infinity/NaN.
 * @param {number[]} num numerator of the open loop L(s)
 * @param {number[]} den denominator of the open loop L(s)
 */
export function stabilityRangeK(num, den) {
  num = polyTrim(num); den = polyTrim(den);
  const crossings = jwCrossingsK(num, den);
  const cand = crossings.map((c) => c.K);
  // Gains where the order drops (a root escapes to infinity): leading coefficient of den + K num vanishes.
  if (num.length === den.length && num[0] !== 0) cand.push(-den[0] / num[0]);
  const ks = Array.from(new Set(cand.map((k) => +k.toPrecision(12)))).sort((a, b) => a - b);
  const stableAt = (K) => {
    const p = charPolyK(num, den, K);
    if (p.length < 2) return false;
    const roots = polyRoots(p);
    return roots.every((r) => r[0] < -1e-9 * Math.max(1, Math.hypot(r[0], r[1])));
  };
  const probes = [];
  const span = Math.max(1, ...ks.map(Math.abs));
  if (ks.length === 0) probes.push({ lo: -Infinity, hi: Infinity, K: 0 }, { lo: -Infinity, hi: Infinity, K: 1 });
  else {
    probes.push({ lo: -Infinity, hi: ks[0], K: ks[0] - span });
    for (let i = 0; i + 1 < ks.length; i++) probes.push({ lo: ks[i], hi: ks[i + 1], K: 0.5 * (ks[i] + ks[i + 1]) });
    probes.push({ lo: ks[ks.length - 1], hi: Infinity, K: ks[ks.length - 1] + span });
  }
  let intervals = [];
  if (ks.length === 0) {
    if (stableAt(1) || stableAt(0)) intervals = [[-Infinity, Infinity]];
  } else {
    for (const pr of probes) if (stableAt(pr.K)) intervals.push([pr.lo, pr.hi]);
  }
  // merge adjacent
  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && last[1] === iv[0]) last[1] = iv[1]; else merged.push(iv.slice());
  }
  const pos = merged.find((iv) => iv[0] <= 0 + 1e-12 && iv[1] > 0) || merged.find((iv) => iv[1] > 0);
  return { intervals: merged, critical: crossings, kMax: pos ? pos[1] : NaN, kMin: pos ? pos[0] : NaN };
}

/**
 * The Routh table of den + K num evaluated at a given K (what a student fills in by hand), plus the verdict.
 */
export const routhAtK = (num, den, K) => routhArray(charPolyK(num, den, K));

/** Divide out the auxiliary polynomial: roots of the jw-axis factor (convenience for zero-row cases). */
export function auxiliaryRoots(p) {
  const r = routhArray(p);
  return r.auxiliary.map((a) => polyRoots(a));
}
