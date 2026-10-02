// Discrete wavelet filter families.
//
// Each family: { id, name, kind: 'orthogonal'|'biorthogonal', order, vanishingMoments,
//                dec_lo, dec_hi, rec_lo, rec_hi, length }   (filters are Float64Array, all of equal length)
//
// Conventions (used consistently by dwt.js; perfect reconstruction is proven in the tests):
//   * rec_lo / dec_lo  sum to sqrt(2).
//   * dec_hi[k] = (-1)^(k+1) rec_lo[k]      rec_hi[k] = (-1)^k dec_lo[k]   (so the Haar wavelet is +1 then -1)
//   * orthogonal families: dec_lo is rec_lo reversed, so rec_lo = h is the usual scaling filter
//     (Daubechies filters are minimum phase: energy concentrated at the front, like PyWavelets).
//   * `vanishingMoments` is the number of vanishing moments of the ANALYSIS wavelet (dec_hi), i.e.
//     the order of the zero of rec_lo at z = -1. For biorthogonal families `vanishingMomentsRec` is
//     the number of vanishing moments of the synthesis wavelet (rec_hi).
//
// Generation (nothing is typed from tables except the coiflets, which the tests verify):
//   * dbN   spectral factorisation of the Daubechies polynomial P_N(y) = sum_k C(N-1+k, k) y^k with
//           y = sin^2(w/2); roots y -> z via z + 1/z = 2 - 4y; keep one root of each reciprocal pair.
//   * symN  the same roots, but the inside/outside choice per root orbit is the one whose phase is
//           closest to linear (least asymmetric).
//   * biorNr.Nd  Cohen-Daubechies-Feauveau construction: rec_lo = spline (1+z)^Nr [* some Q roots],
//           dec_lo = (1+z)^Nd * remaining Q roots, with rec_lo(z) dec_lo(z) half-band. 1.x, 2.x, 3.x use a
//           pure spline for rec_lo; 4.4, 5.5, 6.8 split the Q roots (CDF 9/7-like). 5.5 and 6.8 are
//           valid biorthogonal filter banks of that size but may not equal the PyWavelets coefficients.
//   * coifN solutions of the Coifman moment + orthonormality equations (see COIF_TABLE), polished to
//           machine precision with Levenberg-Marquardt offline.
import * as C from '../complex.js';
import { polyRoots } from '../pade.js';

const SQRT2 = Math.SQRT2;

function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function mulPoly(p, q) {
  const r = Array.from({ length: p.length + q.length - 1 }, () => [0, 0]);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) r[i + j] = C.add(r[i + j], C.mul(p[i], q[j]));
  }
  return r;
}

/** Real polynomial with factor (1+z)^N and the given complex roots, normalised to sum sqrt(2). */
function filterFromRoots(N, roots) {
  let poly = [[1, 0]];
  for (let i = 0; i < N; i++) poly = mulPoly(poly, [[1, 0], [1, 0]]);
  for (const r of roots) poly = mulPoly(poly, [C.neg(r), [1, 0]]);
  const h = poly.map((c) => c[0]);
  const sum = h.reduce((a, b) => a + b, 0);
  return h.map((v) => (v * SQRT2) / sum);
}

/**
 * Root orbits of the Daubechies half-band polynomial P_K. Each orbit is a reciprocal-conjugate
 * group of z-roots: {inside:[...], outside:[...]} with inside roots in |z|<1 and outside = 1/inside.
 * Real y-roots give 1 real z (orbit degree 2 in the full Q), complex pairs give a conjugate pair.
 */
function halfbandOrbits(K) {
  const P = [];
  for (let k = 0; k < K; k++) P.push([binom(K - 1 + k, k), 0]);
  const ys = K > 1 ? polyRoots(P) : [];
  const orbits = [];
  for (const y of ys) {
    if (Math.abs(y[1]) <= 1e-9 * Math.max(1, C.abs(y))) {
      const u = 1 - 2 * y[0];
      const s = Math.sqrt(u * u - 1);
      const zin = u > 0 ? u - s : u + s; // root with |z| < 1
      orbits.push({ real: true, inside: [[zin, 0]], outside: [[1 / zin, 0]] });
    } else if (y[1] > 0) {
      const u = C.sub([1, 0], C.scale(y, 2));
      const s = C.sqrt(C.sub(C.mul(u, u), [1, 0]));
      let z = C.add(u, s);
      if (C.abs(z) > 1) z = C.sub(u, s);
      const zi = C.div([1, 0], z);
      orbits.push({ real: false, inside: [z, C.conj(z)], outside: [zi, C.conj(zi)] });
    }
  }
  return orbits;
}

/** RMS deviation of the unwrapped phase of prod(e^{iw} - r) from the best straight line on (0, pi). */
function phaseNonlinearity(roots) {
  const M = 256;
  let total = [];
  for (let i = 0; i < M; i++) total.push(0);
  for (const r of roots) {
    let prev = null;
    let off = 0;
    for (let i = 0; i < M; i++) {
      const w = (Math.PI * (i + 0.5)) / M;
      let ph = Math.atan2(Math.sin(w) - r[1], Math.cos(w) - r[0]);
      if (prev !== null) {
        while (ph + off - prev > Math.PI) off -= 2 * Math.PI;
        while (ph + off - prev < -Math.PI) off += 2 * Math.PI;
      }
      ph += off;
      prev = ph;
      total[i] += ph;
    }
  }
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < M; i++) {
    const x = (Math.PI * (i + 0.5)) / M;
    sx += x; sy += total[i]; sxx += x * x; sxy += x * total[i];
  }
  const slope = (M * sxy - sx * sy) / (M * sxx - sx * sx);
  const icpt = (sy - slope * sx) / M;
  let e = 0;
  for (let i = 0; i < M; i++) {
    const x = (Math.PI * (i + 0.5)) / M;
    e += (total[i] - slope * x - icpt) ** 2;
  }
  return Math.sqrt(e / M);
}

const reverse = (a) => a.slice().reverse();
const energyCentroid = (h) => h.reduce((s, v, k) => s + k * v * v, 0) / h.reduce((s, v) => s + v * v, 0);

/** Minimum-phase Daubechies scaling filter (front-loaded energy), length 2N. */
function daubechiesFilter(N) {
  if (N === 1) return [Math.SQRT1_2, Math.SQRT1_2];
  const roots = halfbandOrbits(N).flatMap((o) => o.inside);
  const h = filterFromRoots(N, roots); // roots inside the disc: energy at the END
  return reverse(h);
}

/** Least-asymmetric Daubechies filter (symlet), length 2N. */
function symletFilter(N) {
  const orbits = halfbandOrbits(N);
  let best = null;
  for (let mask = 0; mask < 1 << orbits.length; mask++) {
    const roots = orbits.flatMap((o, i) => ((mask >> i) & 1 ? o.outside : o.inside));
    const asym = phaseNonlinearity(roots);
    if (best === null || asym < best.asym - 1e-12) best = { asym, roots, mask };
  }
  let h = filterFromRoots(N, best.roots);
  if (N >= 4 && energyCentroid(h) < (h.length - 1) / 2) h = reverse(h);
  return h;
}

/** Hi-pass filters from the two lo-pass ones (see header). */
function completeBank(id, name, kind, order, vm, vmRec, dec_lo, rec_lo, extra = {}) {
  const L = dec_lo.length;
  const dec_hi = new Float64Array(L);
  const rec_hi = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    dec_hi[k] = (k % 2 ? 1 : -1) * rec_lo[k];
    rec_hi[k] = (k % 2 ? -1 : 1) * dec_lo[k];
  }
  return {
    id, name, kind, order, vanishingMoments: vm, vanishingMomentsRec: vmRec, length: L,
    dec_lo: Float64Array.from(dec_lo), dec_hi, rec_lo: Float64Array.from(rec_lo), rec_hi, ...extra,
  };
}

function orthogonalFamily(id, name, order, vm, h) {
  return completeBank(id, name, 'orthogonal', order, vm, vm, reverse(h), h);
}

/** CDF-type biorthogonal pair (Nr, Nd): returns { rec_lo, dec_lo } with equal length L, aligned for PR. */
function biorthogonalFilters(Nr, Nd, splitDegree) {
  const K = (Nr + Nd) / 2;
  const orbits = halfbandOrbits(K);
  const all = (o) => [...o.inside, ...o.outside];
  const degree = (o) => (o.real ? 2 : 4);
  let setR = [];
  let setD = orbits.flatMap(all);
  if (splitDegree > 0) {
    // choose the subset of orbits of total degree splitDegree for rec_lo with the smallest filter energy
    let best = null;
    for (let mask = 0; mask < 1 << orbits.length; mask++) {
      let deg = 0;
      orbits.forEach((o, i) => { if ((mask >> i) & 1) deg += degree(o); });
      if (deg !== splitDegree) continue;
      const rR = orbits.flatMap((o, i) => ((mask >> i) & 1 ? all(o) : []));
      const rD = orbits.flatMap((o, i) => ((mask >> i) & 1 ? [] : all(o)));
      const e = filterFromRoots(Nr, rR).reduce((s, v) => s + v * v, 0)
        + filterFromRoots(Nd, rD).reduce((s, v) => s + v * v, 0);
      if (best === null || e < best.e - 1e-12) best = { e, rR, rD };
    }
    if (!best) throw new Error(`no root split for bior${Nr}.${Nd}`);
    setR = best.rR;
    setD = best.rD;
  }
  const r0 = filterFromRoots(Nr, setR);
  const g0 = filterFromRoots(Nd, setD);
  let L = Math.max(r0.length, g0.length);
  if (L % 2) L++;
  // The product rec_lo * dec_lo is palindromic about index 2K-1; PR needs it centred at L-1.
  const sum = L - 2 * K; // s_r + s_g
  let sr = -1;
  const ideal = (L - r0.length) / 2;
  for (let s = 0; s <= L - r0.length; s++) {
    const sg = sum - s;
    if (sg < 0 || sg > L - g0.length) continue;
    if (sr < 0 || Math.abs(s - ideal) < Math.abs(sr - ideal)) sr = s;
  }
  const sg = sum - sr;
  const place = (f, s) => {
    const out = new Array(L).fill(0);
    f.forEach((v, k) => { out[k + s] = v; });
    return out;
  };
  return { rec_lo: place(r0, sr), dec_lo: place(g0, sg) };
}

const BIOR_IDS = [[1, 1], [1, 3], [1, 5], [2, 2], [2, 4], [2, 6], [2, 8], [3, 1], [3, 3], [3, 5], [3, 7], [3, 9],
  [4, 4], [5, 5], [6, 8]];
// total degree of the Q roots given to rec_lo (0 = pure spline)
const BIOR_SPLIT = { '4.4': 2, '5.5': 4, '6.8': 4 };

// Coiflets (6N taps): rec_lo, i.e. Daubechies' coiflet coefficients reversed. Solutions of
//   sum h = sqrt2, orthonormality, sum (-1)^k k^p h_k = 0 (p < 2N), sum (k - k0)^p h_k = 0 (1 <= p < 2N)
// polished to machine precision; the tests re-verify every one of these conditions.
const COIF_TABLE = {
  1: [
    -0.01565572813579184,
    -0.07273261951252642,
    0.3848648468648575,
    0.8525720202116005,
    0.337897662457482,
    -0.07273261951252645,
  ],
  2: [
    -0.00072054944552192,
    -0.001823208870957549,
    0.005611434819456967,
    0.023680171946982676,
    -0.059434418646773395,
    -0.07648859907835726,
    0.41700518442375006,
    0.8127236354492946,
    0.38611006682242305,
    -0.06737255472356515,
    -0.041464936786787206,
    0.016387336463150257,
  ],
  3: [
    -3.4599773199955734e-05,
    -7.098330250584647e-05,
    0.0004662169598253027,
    0.0011175187708846492,
    -0.002574517688199561,
    -0.009007976136959604,
    0.015880544863966253,
    0.03455502757357579,
    -0.08230192710676373,
    -0.07179982161908967,
    0.4284834763774692,
    0.7937772226257251,
    0.405176902409554,
    -0.06112339000277471,
    -0.06577191128190317,
    0.02345269614210891,
    0.00778259642579933,
    -0.003793512864417001,
  ],
  4: [
    -1.7849915943607383e-06,
    -3.259649950523906e-06,
    3.122987161211114e-05,
    6.233886962061387e-05,
    -0.000259974374057037,
    -0.0005890203665047035,
    0.0012665612652307658,
    0.0037514354216800073,
    -0.0056582849388665925,
    -0.015211730050447413,
    0.025082257405893937,
    0.03933442498836553,
    -0.0962204330188621,
    -0.06662747317276096,
    0.43438604409942616,
    0.7822389325157133,
    0.41530841796640927,
    -0.05607731653104294,
    -0.08126670563349853,
    0.02668230258113106,
    0.016068945790077668,
    -0.007346167220701071,
    -0.001629492255223796,
    0.0008923138014445367,
  ],
  5: [
    -9.608886943649234e-08,
    -1.6244534573941164e-07,
    2.061869984423948e-06,
    3.7021153038677122e-06,
    -2.127540787440886e-05,
    -4.122977227367992e-05,
    0.00014037751171707235,
    0.00030191867159911305,
    -0.0006376372960858976,
    -0.0016619221521209765,
    0.002431968049650415,
    0.006762447648390905,
    -0.00916113185862899,
    -0.01976017465510885,
    0.03267923570175124,
    0.0412894407164706,
    -0.10557120271742118,
    -0.06203826839779617,
    0.4379922903073874,
    0.7742920423952415,
    0.42156271796475986,
    -0.052044060052106864,
    -0.09191659333424573,
    0.02816770169195313,
    0.02340641459056073,
    -0.010130658517822118,
    -0.004158882259610581,
    0.0021780600383723915,
    0.00035853415347282633,
    -0.00021205609820943103,
  ],
};

const families = [];

families.push(orthogonalFamily('haar', 'Haar', 1, 1, daubechiesFilter(1)));
for (let N = 2; N <= 10; N++) {
  families.push(orthogonalFamily(`db${N}`, `Daubechies ${N}`, N, N, daubechiesFilter(N)));
}
for (let N = 2; N <= 10; N++) {
  const h = N <= 3 ? daubechiesFilter(N) : symletFilter(N); // sym2 = db2, sym3 = db3
  families.push(orthogonalFamily(`sym${N}`, `Symlet ${N}`, N, N, h));
}
for (let N = 1; N <= 5; N++) {
  families.push(orthogonalFamily(`coif${N}`, `Coiflet ${N}`, N, 2 * N, COIF_TABLE[N]));
}
const biors = BIOR_IDS.map(([Nr, Nd]) => {
  const { rec_lo, dec_lo } = biorthogonalFilters(Nr, Nd, BIOR_SPLIT[`${Nr}.${Nd}`] || 0);
  return { Nr, Nd, rec_lo, dec_lo };
});
for (const { Nr, Nd, rec_lo, dec_lo } of biors) {
  families.push(completeBank(`bior${Nr}.${Nd}`, `Biorthogonal ${Nr}.${Nd}`, 'biorthogonal', Nr, Nr, Nd, dec_lo, rec_lo,
    { nr: Nr, nd: Nd }));
}
// rbio: decomposition and reconstruction roles swapped.
for (const { Nr, Nd, rec_lo, dec_lo } of biors) {
  families.push(completeBank(`rbio${Nr}.${Nd}`, `Reverse biorthogonal ${Nr}.${Nd}`, 'biorthogonal', Nd, Nd, Nr,
    rec_lo, dec_lo, { nr: Nd, nd: Nr }));
}

/** All shipped wavelet families (haar, db2-10, sym2-10, coif1-5, bior*, rbio*). */
export const FAMILIES = families;

const ALIASES = { db1: 'haar' };

/** Family by id (`db1` is an alias of `haar`); undefined if unknown. */
export const getFamily = (id) => FAMILIES.find((f) => f.id === (ALIASES[id] || id));
