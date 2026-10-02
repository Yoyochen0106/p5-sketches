// Polynomial interpolation on [a, b] with the numerically stable (second, "true") barycentric formula.
//
//   p(x) = sum_j w_j f_j / (x - x_j)  /  sum_j w_j / (x - x_j)
//
// Node families (n = degree, so n + 1 nodes; nodes are returned in ascending order):
//   'equispaced'  a + (b - a) j / n
//   'chebyshev'   Chebyshev points of the first kind  (roots of T_{n+1}):    cos((2j + 1) pi / (2n + 2))
//   'lobatto'     Chebyshev points of the second kind (extrema of T_n):       cos(j pi / n)
//   'legendre'    Legendre-Gauss nodes (roots of P_{n+1})
// For n = 0 every family degenerates to the midpoint of [a, b].
import * as C from './complex.js';

export const NODE_FAMILIES = [
  { id: 'equispaced', label: 'equispaced' },
  { id: 'chebyshev', label: 'Chebyshev (1st kind)' },
  { id: 'lobatto', label: 'Chebyshev-Lobatto (2nd kind)' },
  { id: 'legendre', label: 'Legendre-Gauss' },
];

const EULER_GAMMA = 0.5772156649015329;

/** Roots of the Legendre polynomial P_m on (-1, 1), ascending (Newton iteration on the recurrence). */
function legendreRoots(m) {
  const t = new Array(m);
  for (let i = 0; i < m; i++) {
    let x = -Math.cos((Math.PI * (i + 0.75)) / (m + 0.5));
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= m; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      const pm = m === 1 ? x : p1;
      const prev = m === 1 ? 1 : p0;
      const dp = (m * (x * pm - prev)) / (x * x - 1);
      const dx = pm / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    t[i] = x;
  }
  return t.sort((u, v) => u - v);
}

/** Reference nodes on [-1, 1], ascending. */
function referenceNodes(family, n) {
  if (!(n >= 0) || !Number.isInteger(n)) throw new Error('interp: degree must be a non-negative integer');
  if (!NODE_FAMILIES.some((f) => f.id === family)) throw new Error(`interp: unknown node family "${family}"`);
  if (n === 0) return [0];
  const t = new Array(n + 1);
  switch (family) {
    case 'equispaced':
      for (let j = 0; j <= n; j++) t[j] = -1 + (2 * j) / n;
      break;
    case 'chebyshev':
      for (let j = 0; j <= n; j++) t[j] = -Math.cos(((2 * j + 1) * Math.PI) / (2 * n + 2));
      break;
    case 'lobatto':
      for (let j = 0; j <= n; j++) t[j] = -Math.cos((j * Math.PI) / n);
      t[0] = -1;
      t[n] = 1;
      break;
    default:
      return legendreRoots(n + 1);
  }
  return t;
}

/** n + 1 interpolation nodes of the given family on [a, b], ascending. */
export function nodes(family, n, a = -1, b = 1) {
  return referenceNodes(family, n).map((t) => a + ((t + 1) * (b - a)) / 2);
}

/** O(n^2) barycentric weights 1 / prod_{k != j} (x_j - x_k) for arbitrary distinct nodes in [-1, 1]. */
export function genericWeights(xs) {
  return xs.map((xj, j) => {
    let prod = 1;
    for (let k = 0; k < xs.length; k++) if (k !== j) prod *= xj - xs[k];
    return 1 / prod;
  });
}

/** Barycentric weights (up to a common factor) for the nodes of `family` with degree n. */
export function baryWeights(family, n) {
  if (n === 0) return [1];
  const w = new Array(n + 1);
  if (family === 'equispaced') {
    let c = 1;
    for (let j = 0; j <= n; j++) {
      w[j] = (j % 2 ? -1 : 1) * c;
      c = (c * (n - j)) / (j + 1);
    }
  } else if (family === 'chebyshev') {
    for (let j = 0; j <= n; j++) w[j] = (j % 2 ? -1 : 1) * Math.sin(((2 * j + 1) * Math.PI) / (2 * n + 2));
  } else if (family === 'lobatto') {
    for (let j = 0; j <= n; j++) w[j] = (j % 2 ? -1 : 1) * (j === 0 || j === n ? 0.5 : 1);
  } else {
    return genericWeights(referenceNodes(family, n));
  }
  return w;
}

/** Evaluate the barycentric interpolant through (xs, fs) with weights w at real x. */
export function baryEval(xs, fs, w, x) {
  let num = 0;
  let den = 0;
  for (let j = 0; j < xs.length; j++) {
    const d = x - xs[j];
    if (d === 0) return fs[j];
    const t = w[j] / d;
    num += t * fs[j];
    den += t;
  }
  return num / den;
}

/** Same at a complex z (array [re, im] or a number); returns [re, im]. */
export function baryEvalComplex(xs, fs, w, z) {
  const [zr, zi] = Array.isArray(z) ? z : [z, 0];
  let nr = 0;
  let ni = 0;
  let dr = 0;
  let di = 0;
  for (let j = 0; j < xs.length; j++) {
    const ar = zr - xs[j];
    if (ar === 0 && zi === 0) return [fs[j], 0];
    const inv = C.div([w[j], 0], [ar, zi]);
    nr += inv[0] * fs[j];
    ni += inv[1] * fs[j];
    dr += inv[0];
    di += inv[1];
  }
  return C.div([nr, ni], [dr, di]);
}

/**
 * Interpolate f at the nodes of `family` (degree n) on [a, b].
 * Returns { family, n, a, b, xs, fs, w, evalReal(x), evalComplex(z) }.
 * Throws if f is not finite at a node.
 */
export function interpolate(f, { family = 'chebyshev', n, a = -1, b = 1 }) {
  if (!(b > a)) throw new Error('interp: need a < b');
  const xs = nodes(family, n, a, b);
  const fs = xs.map((x) => f(x));
  if (!fs.every(Number.isFinite)) throw new Error('f is not finite at an interpolation node');
  const w = baryWeights(family, n);
  return {
    family, n, a, b, xs, fs, w,
    evalReal: (x) => baryEval(xs, fs, w, x),
    evalComplex: (z) => baryEvalComplex(xs, fs, w, z),
  };
}

/**
 * Lebesgue constant estimate  max_{x in [a,b]} sum_j |l_j(x)|, sampled with `perInterval` points
 * in every gap between consecutive nodes and in the two outer gaps (to the window edges).
 */
export function lebesgueConstant({ xs, w, a, b }, perInterval = 48) {
  const lam = (x) => {
    let s = 0;
    let den = 0;
    for (let j = 0; j < xs.length; j++) {
      const d = x - xs[j];
      if (d === 0) return 1;
      const t = w[j] / d;
      s += Math.abs(t);
      den += t;
    }
    return s / Math.abs(den);
  };
  const edges = [a, ...xs, b];
  let best = 1;
  for (let i = 0; i + 1 < edges.length; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    if (!(hi > lo)) continue;
    for (let s = 0; s <= perInterval; s++) {
      const v = lam(lo + ((hi - lo) * s) / perInterval);
      if (Number.isFinite(v) && v > best) best = v;
    }
  }
  return best;
}

/** Classical asymptotic estimate of the Lebesgue constant (NaN for families without a simple formula). */
export function lebesgueAsymptotic(family, n) {
  if (n < 1) return 1;
  if (family === 'equispaced') return 2 ** (n + 1) / (Math.E * n * (Math.log(n) + EULER_GAMMA));
  if (family === 'chebyshev') return (2 / Math.PI) * Math.log(n + 1) + 0.9625;
  if (family === 'lobatto') return (2 / Math.PI) * Math.log(n) + 0.9625;
  return NaN;
}

/** max |f - p| over [a, b] (finite samples only), `samples` + 1 uniform points. */
export function maxError(f, p, a, b, samples = 1500) {
  let m = 0;
  for (let i = 0; i <= samples; i++) {
    const x = a + ((b - a) * i) / samples;
    const e = Math.abs(f(x) - p.evalReal(x));
    if (Number.isFinite(e) && e > m) m = e;
  }
  return m;
}
