// Algebras: write a function definition ONCE as def(A, x) and evaluate it over
//   realAlg           numbers
//   complexAlg        [re, im] tuples
//   seriesAlg(n, c)   truncated power series about c (arrays of n+1 complex coefficients,
//                     coefficient k = f^(k)(c) / k!, in powers of (x - c))
// An algebra provides: const(r), one, zero, add, sub, mul, div, neg, exp, log, sin, cos, tan,
// sinh, cosh, tanh, atan, sqrt, pow(x, realExponent). realAlg additionally provides abs.
// The variable placeholder x is passed in by the caller: a number, [re, im], or seriesVariable(n, c).
import * as C from './complex.js';

export const realAlg = {
  name: 'real',
  const: (r) => r,
  one: 1,
  zero: 0,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  neg: (a) => -a,
  exp: Math.exp,
  log: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  pow: (a, p) => Math.pow(a, p),
};

export const complexAlg = {
  name: 'complex',
  const: (r) => [r, 0],
  one: [1, 0],
  zero: [0, 0],
  add: C.add,
  sub: C.sub,
  mul: C.mul,
  div: C.div,
  neg: C.neg,
  exp: C.exp,
  log: C.log,
  sin: C.sin,
  cos: C.cos,
  tan: C.tan,
  sinh: C.sinh,
  cosh: C.cosh,
  tanh: C.tanh,
  atan: C.atan,
  sqrt: C.sqrt,
  pow: (a, p) => C.pow(a, [p, 0]),
};

const asComplex = (c) => (Array.isArray(c) ? c : [c, 0]);
const TINY = 0; // exact-zero test for leading coefficients (shift in division)

/** Series for the identity function x around `center` (number or [re, im]): [c, 1, 0, ...]. */
export function seriesVariable(n, center) {
  const s = Array.from({ length: n + 1 }, () => [0, 0]);
  s[0] = asComplex(center).slice();
  if (n >= 1) s[1] = [1, 0];
  return s;
}

/**
 * Truncated power series algebra of order n (n+1 coefficients) about `center`.
 * All operations are exact power-series arithmetic (Cauchy product, division and the standard
 * exp/log/sin/cos/atan/pow recurrences); no numerical differentiation.
 */
export function seriesAlg(n, center = 0) {
  const len = n + 1;
  const zeros = () => Array.from({ length: len }, () => [0, 0]);
  const cst = (z) => {
    const s = zeros();
    s[0] = asComplex(z).slice();
    return s;
  };

  const add = (a, b) => a.map((v, k) => C.add(v, b[k]));
  const sub = (a, b) => a.map((v, k) => C.sub(v, b[k]));
  const neg = (a) => a.map(C.neg);

  function mul(a, b) {
    const r = zeros();
    for (let k = 0; k < len; k++) {
      let re = 0;
      let im = 0;
      for (let j = 0; j <= k; j++) {
        const x = a[j];
        const y = b[k - j];
        re += x[0] * y[0] - x[1] * y[1];
        im += x[0] * y[1] + x[1] * y[0];
      }
      r[k] = [re, im];
    }
    return r;
  }

  function div(a, b) {
    // Shift away exact leading zeros of the denominator (e.g. sin(x)/x about 0). Terms that would
    // need coefficients beyond the truncation order are left at zero.
    let m = 0;
    while (m < len && Math.abs(b[m][0]) <= TINY && Math.abs(b[m][1]) <= TINY) m++;
    if (m === len) return a.map(() => [NaN, NaN]);
    const aa = a.slice(m).concat(Array.from({ length: m }, () => [0, 0]));
    const bb = b.slice(m).concat(Array.from({ length: m }, () => [0, 0]));
    const c = zeros();
    for (let k = 0; k < len; k++) {
      let acc = aa[k];
      for (let j = 1; j <= k; j++) acc = C.sub(acc, C.mul(bb[j], c[k - j]));
      c[k] = C.div(acc, bb[0]);
    }
    return c;
  }

  // g = exp(f):  g_k = (1/k) sum_{j=1..k} j f_j g_{k-j}
  function exp(f) {
    const g = zeros();
    g[0] = C.exp(f[0]);
    for (let k = 1; k < len; k++) {
      let re = 0;
      let im = 0;
      for (let j = 1; j <= k; j++) {
        const p = C.mul(f[j], g[k - j]);
        re += j * p[0];
        im += j * p[1];
      }
      g[k] = [re / k, im / k];
    }
    return g;
  }

  // g = log(f):  f' = f g'  =>  g_k = (f_k - (1/k) sum_{j=1..k-1} j g_j f_{k-j}) / f_0
  function log(f) {
    const g = zeros();
    g[0] = C.log(f[0]);
    for (let k = 1; k < len; k++) {
      let re = 0;
      let im = 0;
      for (let j = 1; j < k; j++) {
        const p = C.mul(g[j], f[k - j]);
        re += j * p[0];
        im += j * p[1];
      }
      g[k] = C.div(C.sub(f[k], [re / k, im / k]), f[0]);
    }
    return g;
  }

  // (s, c) = (sin f, cos f) or (sinh f, cosh f): s' = c f', c' = +-s f'
  function sincos(f, hyperbolic) {
    const s = zeros();
    const c = zeros();
    s[0] = hyperbolic ? C.sinh(f[0]) : C.sin(f[0]);
    c[0] = hyperbolic ? C.cosh(f[0]) : C.cos(f[0]);
    const sign = hyperbolic ? 1 : -1;
    for (let k = 1; k < len; k++) {
      let sr = 0, si = 0, cr = 0, ci = 0;
      for (let j = 1; j <= k; j++) {
        const p = C.mul(f[j], c[k - j]);
        const q = C.mul(f[j], s[k - j]);
        sr += j * p[0]; si += j * p[1];
        cr += j * q[0]; ci += j * q[1];
      }
      s[k] = [sr / k, si / k];
      c[k] = [(sign * cr) / k, (sign * ci) / k];
    }
    return [s, c];
  }

  // g = atan(f) = atan(f_0) + integral of f' / (1 + f^2)
  function atan(f) {
    const g = zeros();
    g[0] = C.atan(f[0]);
    if (n === 0) return g;
    const df = zeros();
    for (let k = 0; k < n; k++) df[k] = C.scale(f[k + 1], k + 1);
    const q = div(df, add(cst(1), mul(f, f)));
    for (let k = 1; k < len; k++) g[k] = C.scale(q[k - 1], 1 / k);
    return g;
  }

  function powInt(f, p) {
    if (p < 0) return div(cst(1), powInt(f, -p));
    let result = cst(1);
    let base = f;
    let e = p;
    while (e > 0) {
      if (e & 1) result = mul(result, base);
      e >>= 1;
      if (e > 0) base = mul(base, base);
    }
    return result;
  }

  // g = f^p (real p):  f g' = p f' g  =>  g_k = 1/(k f_0) sum_{j=1..k} (p j - (k - j)) f_j g_{k-j}
  function pow(f, p) {
    if (Number.isInteger(p) && Math.abs(p) <= 4096) return powInt(f, p);
    const g = zeros();
    if (f[0][0] === 0 && f[0][1] === 0) {
      // Branch point: no power series exists.
      return g.map(() => [NaN, NaN]);
    }
    g[0] = C.pow(f[0], [p, 0]);
    for (let k = 1; k < len; k++) {
      let re = 0;
      let im = 0;
      for (let j = 1; j <= k; j++) {
        const t = C.mul(f[j], g[k - j]);
        const w = p * j - (k - j);
        re += w * t[0];
        im += w * t[1];
      }
      g[k] = C.div([re / k, im / k], f[0]);
    }
    return g;
  }

  return {
    name: 'series',
    n,
    center: asComplex(center).slice(),
    const: cst,
    one: cst(1),
    zero: zeros(),
    add, sub, mul, div, neg, exp, log, atan, pow,
    sin: (f) => sincos(f, false)[0],
    cos: (f) => sincos(f, false)[1],
    tan: (f) => { const [s, c] = sincos(f, false); return div(s, c); },
    sinh: (f) => sincos(f, true)[0],
    cosh: (f) => sincos(f, true)[1],
    tanh: (f) => { const [s, c] = sincos(f, true); return div(s, c); },
    sqrt: (f) => pow(f, 0.5),
  };
}
