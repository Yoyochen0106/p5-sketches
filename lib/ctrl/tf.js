/**
 * Polynomials and continuous-time transfer functions (the shared model of the Control Systems course).
 *
 * Conventions
 *  - A polynomial is an array of real coefficients, HIGHEST power first: [1, 2, 1] = s^2 + 2s + 1.
 *  - A complex number is [re, im] (same as lib/complex.js).
 *  - A transfer function (TF) is a plain object {num, den, delay} with delay >= 0 seconds
 *    (pure transport delay e^{-s*delay}); build it with tf(). TF objects are treated as immutable.
 *  - Algebra (series/parallel/feedback) works on the rational part; delays add in series, must match in
 *    parallel, and are rejected inside feedback loops (use withPade() first to turn them into a rational TF).
 */
import { rootsHF } from './_mat.js';

// ---------------------------------------------------------------- polynomials

/** Remove leading coefficients with |c| <= eps (keeps at least one entry). */
export function polyTrim(p, eps = 0) {
  let i = 0;
  while (i < p.length - 1 && Math.abs(p[i]) <= eps) i++;
  return i ? p.slice(i) : p.slice();
}
export const polyDegree = (p) => polyTrim(p).length - 1;
export const polyNeg = (p) => p.map((c) => -c);
export const polyScale = (p, k) => p.map((c) => c * k);

export function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < a.length; i++) out[n - a.length + i] += a[i];
  for (let i = 0; i < b.length; i++) out[n - b.length + i] += b[i];
  return polyTrim(out);
}
export const polySub = (a, b) => polyAdd(a, polyNeg(b));

export function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return polyTrim(out);
}

/** Integer power of a polynomial. */
export function polyPow(p, n) {
  let out = [1];
  for (let i = 0; i < n; i++) out = polyMul(out, p);
  return out;
}

/** d/ds of a polynomial. */
export function polyDeriv(p) {
  const n = p.length - 1;
  if (n < 1) return [0];
  return p.slice(0, n).map((c, i) => c * (n - i));
}

/** Evaluate a real polynomial at real x (Horner). */
export function polyEval(p, x) {
  let r = 0;
  for (const c of p) r = r * x + c;
  return r;
}

/** Evaluate a real polynomial at complex z = [re, im]. */
export function polyEvalC(p, z) {
  let re = 0, im = 0;
  for (const c of p) {
    const nr = re * z[0] - im * z[1] + c;
    im = re * z[1] + im * z[0];
    re = nr;
  }
  return [re, im];
}

/** Polynomial long division: a = q*b + r. */
export function polyDivide(a, b) {
  b = polyTrim(b);
  let r = polyTrim(a);
  if (b.length === 1 && b[0] === 0) throw new Error('polynomial division by zero');
  if (r.length < b.length) return { q: [0], r };
  const q = new Array(r.length - b.length + 1).fill(0);
  r = r.slice();
  for (let i = 0; i < q.length; i++) {
    const f = r[i] / b[0];
    q[i] = f;
    for (let j = 0; j < b.length; j++) r[i + j] -= f * b[j];
  }
  return { q: polyTrim(q), r: polyTrim(r.slice(q.length), 0) };
}

/** Roots of a polynomial (highest power first) as [re, im] pairs. */
export function polyRoots(p) {
  p = polyTrim(p, 0);
  if (p.length < 2) return [];
  return rootsHF(p).map(cleanRoot);
}

function cleanRoot(z) {
  const t = 1e-10 * Math.max(1, Math.abs(z[0]));
  return Math.abs(z[1]) < t ? [z[0], 0] : z;
}

/** Real polynomial with the given roots (numbers or [re,im]; should be closed under conjugation) and leading coefficient. */
export function polyFromRoots(roots, lead = 1) {
  let p = [[lead, 0]];
  for (const r of roots) {
    const [rr, ri] = Array.isArray(r) ? r : [r, 0];
    const q = new Array(p.length + 1).fill(null).map(() => [0, 0]);
    for (let i = 0; i < p.length; i++) {
      q[i][0] += p[i][0]; q[i][1] += p[i][1];
      // multiply by (-root)
      q[i + 1][0] -= p[i][0] * rr - p[i][1] * ri;
      q[i + 1][1] -= p[i][0] * ri + p[i][1] * rr;
    }
    p = q;
  }
  return p.map((c) => c[0]);
}

/** Human readable polynomial, e.g. formatPoly([1,2,1]) = "s^2 + 2s + 1". */
export function formatPoly(p, { variable = 's', digits = 4 } = {}) {
  p = polyTrim(p);
  const n = p.length - 1;
  const parts = [];
  const num = (x) => String(Number(Math.abs(x).toPrecision(digits)));
  for (let i = 0; i <= n; i++) {
    const c = p[i];
    if (c === 0) continue;
    const pow = n - i;
    let t;
    if (pow === 0) t = num(c);
    else {
      const mag = Math.abs(c) === 1 ? '' : num(c);
      t = mag + variable + (pow > 1 ? `^${pow}` : '');
    }
    parts.push({ neg: c < 0, t });
  }
  if (!parts.length) return '0';
  return parts.map((x, i) => (i === 0 ? (x.neg ? '-' : '') + x.t : (x.neg ? ' - ' : ' + ') + x.t)).join('');
}

// ---------------------------------------------------------------- transfer function object

const asPoly = (v) => (Array.isArray(v) ? v.slice() : [v]);

/**
 * Create a transfer function. num/den are polynomials (highest power first) or plain numbers.
 * Leading zeros are removed. delay is a transport delay in seconds.
 */
export function tf(num, den = [1], delay = 0) {
  const n = polyTrim(asPoly(num));
  const d = polyTrim(asPoly(den));
  if (d.length === 1 && d[0] === 0) throw new Error('tf: zero denominator');
  if (!(delay >= 0) || !Number.isFinite(delay)) throw new Error('tf: delay must be a finite number >= 0');
  return { num: n, den: d, delay };
}

/** Is `G` a TF object? */
export const isTf = (G) => !!G && Array.isArray(G.num) && Array.isArray(G.den) && !('A' in G);

/** Accept a TF, a number (static gain) or {num, den}. */
export function toTf(G) {
  if (typeof G === 'number') return tf([G], [1]);
  if (typeof G === 'string') return parseTf(G);
  return tf(G.num, G.den, G.delay || 0);
}

/** Gain times a TF. */
export const tfGain = (G, k) => tf(polyScale(G.num, k), G.den, G.delay);
export const tfNegate = (G) => tfGain(G, -1);

/** Make the denominator monic (leading coefficient 1). */
export function tfMonic(G) {
  const k = G.den[0];
  return tf(polyScale(G.num, 1 / k), polyScale(G.den, 1 / k), G.delay);
}

/** 1/G (numerator must be non-zero); the delay of G is dropped (an exact inverse would be a predictor). */
export const tfInverse = (G) => tf(G.den, G.num, 0);

/** Series connection G1*G2*...; delays add. */
export function tfSeries(...Gs) {
  let num = [1], den = [1], delay = 0;
  for (const g of Gs) {
    const G = toTf(g);
    num = polyMul(num, G.num);
    den = polyMul(den, G.den);
    delay += G.delay;
  }
  return tf(num, den, delay);
}

/** Parallel connection G1+G2+... (delays must be identical). */
export function tfParallel(...Gs) {
  let num = [0], den = [1];
  let delay = null;
  for (const g of Gs) {
    const G = toTf(g);
    if (delay === null) delay = G.delay;
    else if (Math.abs(G.delay - delay) > 1e-12) throw new Error('tfParallel: different delays; use withPade() first');
    num = polyAdd(polyMul(num, G.den), polyMul(G.num, den));
    den = polyMul(den, G.den);
  }
  return tf(num, den, delay || 0);
}

/**
 * Closed loop of forward path G with feedback path H (default 1): T = G / (1 + G H) for negative feedback
 * (sign = -1, default) or G / (1 - G H) for positive feedback (sign = +1). Delays are rejected: convert with withPade().
 */
export function tfFeedback(G, H = 1, sign = -1) {
  G = toTf(G); H = toTf(H);
  if (G.delay || H.delay) throw new Error('tfFeedback: loop contains a delay; apply withPade(G, order) first');
  const loop = polyMul(G.num, H.num);
  const den = sign < 0 ? polyAdd(polyMul(G.den, H.den), loop) : polySub(polyMul(G.den, H.den), loop);
  return tf(polyMul(G.num, H.den), den, 0);
}

/** Open loop L = G*C (series) convenience used by loop-shaping units. */
export const loopTf = (...Gs) => tfSeries(...Gs);

/** Poles (roots of den) as [re,im] pairs. */
export const tfPoles = (G) => polyRoots(G.den);
/** Zeros (roots of num) as [re,im] pairs. */
export const tfZeros = (G) => polyRoots(G.num);

/** Build a TF from zeros, poles and gain k: k * prod(s - z) / prod(s - p). */
export function tfFromZpk(zeros, poles, k = 1, delay = 0) {
  return tf(polyFromRoots(zeros, k), polyFromRoots(poles, 1), delay);
}
/** {zeros, poles, k} of a TF (k = ratio of leading coefficients). */
export const tfZpk = (G) => ({ zeros: tfZeros(G), poles: tfPoles(G), k: G.num[0] / G.den[0], delay: G.delay });

const ZTOL = 1e-12;
/** Lowest-order nonzero coefficient of p (highest-first array): {power, coef}. */
function lowTerm(p) {
  const mx = Math.max(...p.map(Math.abs));
  if (mx === 0) return { power: Infinity, coef: 0 };
  const n = p.length - 1;
  for (let i = n; i >= 0; i--) if (Math.abs(p[i]) > ZTOL * mx) return { power: n - i, coef: p[i] };
  return { power: Infinity, coef: 0 };
}

/**
 * lim_{s->0} s^k G(s) (k = 0 gives the DC gain). Returns a finite number, 0, or +-Infinity
 * (the sign is that of the limit from s -> 0+).
 */
export function limitAtZero(G, k = 0) {
  const a = lowTerm(G.num), b = lowTerm(G.den);
  if (a.coef === 0) return 0;
  const d = a.power + k - b.power;
  const r = a.coef / b.coef;
  if (d > 0) return 0;
  if (d === 0) return r;
  return r > 0 ? Infinity : -Infinity;
}

/** DC gain G(0) (Infinity when G has a pole at the origin). */
export const dcGain = (G) => limitAtZero(G, 0);

/** System type: the number of poles at the origin. */
export function systemType(G) {
  const a = lowTerm(G.num), b = lowTerm(G.den);
  return Math.max(0, b.power - (a.power === Infinity ? 0 : a.power));
}

/** deg(den) - deg(num). */
export const relativeDegree = (G) => polyDegree(G.den) - polyDegree(G.num);
/** True when deg num <= deg den (realisable). */
export const isProper = (G) => relativeDegree(G) >= 0;
/** True when deg num < deg den. */
export const isStrictlyProper = (G) => relativeDegree(G) > 0;

/** G(s) for complex s = [re, im], including the exact delay factor e^{-s*delay}. */
export function evalTf(G, s) {
  const n = polyEvalC(G.num, s), d = polyEvalC(G.den, s);
  const den2 = d[0] * d[0] + d[1] * d[1];
  let re = (n[0] * d[0] + n[1] * d[1]) / den2;
  let im = (n[1] * d[0] - n[0] * d[1]) / den2;
  if (G.delay) {
    const m = Math.exp(-s[0] * G.delay), ph = -s[1] * G.delay;
    const c = m * Math.cos(ph), sn = m * Math.sin(ph);
    [re, im] = [re * c - im * sn, re * sn + im * c];
  }
  return [re, im];
}
/** G(jw). */
export const evalJw = (G, w) => evalTf(G, [0, w]);

/** Open-loop-stability test: all poles strictly in the left half plane (Re p < -tol). */
export function isStable(G, tol = 1e-9) {
  return tfPoles(G).every((p) => p[0] < -tol * Math.max(1, Math.hypot(p[0], p[1])));
}
/** Number of poles with Re > tol. */
export const countRhpPoles = (G, tol = 1e-9) => tfPoles(G).filter((p) => p[0] > tol * Math.max(1, Math.hypot(p[0], p[1]))).length;

/**
 * Cancel matching pole/zero pairs (|p - z| <= tol * (1 + |p|)). The leading-coefficient ratio is preserved.
 * Use it after series/feedback algebra that produced common factors (e.g. PID * plant).
 */
export function minreal(G, tol = 1e-6) {
  const z = tfZeros(G), p = tfPoles(G);
  const usedP = new Array(p.length).fill(false);
  const keepZ = [];
  for (const zi of z) {
    let best = -1, bd = Infinity;
    p.forEach((pj, j) => {
      if (usedP[j]) return;
      const d = Math.hypot(zi[0] - pj[0], zi[1] - pj[1]);
      if (d < bd) { bd = d; best = j; }
    });
    if (best >= 0 && bd <= tol * (1 + Math.hypot(p[best][0], p[best][1]))) usedP[best] = true;
    else keepZ.push(zi);
  }
  const keepP = p.filter((_, j) => !usedP[j]);
  if (keepP.length === p.length) return G;
  return tf(polyFromRoots(keepZ, G.num[0] / G.den[0]), polyFromRoots(keepP, 1), G.delay);
}

/** Canonical second-order TF  K wn^2 / (s^2 + 2 zeta wn s + wn^2). */
export function secondOrder(zeta, wn, K = 1) {
  return tf([K * wn * wn], [1, 2 * zeta * wn, wn * wn]);
}
/** First-order lag K / (tau s + 1). */
export const firstOrder = (K, tau, delay = 0) => tf([K], [tau, 1], delay);
/** Pure integrator gain/s. */
export const integrator = (k = 1) => tf([k], [1, 0]);
/** Pure gain. */
export const gain = (k) => tf([k], [1]);
/** The Laplace variable s as a TF. */
export const sTf = tf([1, 0], [1]);

/**
 * Extract {zeta, wn, K} from a TF with exactly two poles (K is the DC gain); null otherwise.
 */
export function secondOrderParams(G) {
  if (polyDegree(G.den) !== 2) return null;
  const d = G.den.map((c) => c / G.den[0]);
  const wn2 = d[2];
  if (wn2 <= 0) return null;
  const wn = Math.sqrt(wn2);
  return { wn, zeta: d[1] / (2 * wn), K: dcGain(G) };
}

// ---------------------------------------------------------------- delay

/**
 * Pade approximation of e^{-s T} of the given order as a TF (all-pass, poles in the LHP):
 * N(s)/N(-s) with c_k = (2n-k)! n! / ((2n)! k! (n-k)!).
 */
export function padeDelay(T, order = 3) {
  if (!(T > 0)) return tf([1], [1]);
  const n = order;
  const fact = (m) => { let r = 1; for (let i = 2; i <= m; i++) r *= i; return r; };
  const num = [], den = []; // low power first
  for (let k = 0; k <= n; k++) {
    const c = (fact(2 * n - k) * fact(n)) / (fact(2 * n) * fact(k) * fact(n - k));
    num.push(c * (-T) ** k);
    den.push(c * T ** k);
  }
  return tf(num.reverse(), den.reverse(), 0);
}

/** Replace the transport delay of G by its Pade approximation so G becomes a rational TF. */
export function withPade(G, order = 3) {
  if (!G.delay) return G;
  const P = padeDelay(G.delay, order);
  return tf(polyMul(G.num, P.num), polyMul(G.den, P.den), 0);
}

// ---------------------------------------------------------------- parse / format

/** Format a TF as text that parseTf() reads back, e.g. "(s + 1)/(s^2 + 2s + 1)", delay as "e^(-0.5s)". */
export function formatTf(G, { variable = 's', digits = 4 } = {}) {
  const wrap = (p, isDen = true) => {
    const t = formatPoly(p, { variable, digits });
    return /[ ]/.test(t) || (isDen && t.startsWith("-")) ? `(${t})` : t;
  };
  const dflt = G.den.length === 1 && G.den[0] === 1;
  let out = dflt ? formatPoly(G.num, { variable, digits }) : `${wrap(G.num, false)}/${wrap(G.den)}`;
  if (G.delay) {
    if (dflt && /[ ]/.test(out)) out = `(${out})`;
    out += ` * e^(-${Number(G.delay.toPrecision(digits))}${variable})`;
  }
  return out;
}

/**
 * Parse a rational function of s:  '(s+1)/(s^2+2s+1)', '5/(s(s+1)(s+5))', '2*(s+3)/(s^2+4)',
 * '1/(0.5s+1) * exp(-2s)'. Supports + - * / ^ (integer powers), implicit multiplication ("2s", ")(", "s(") which binds
 * tighter than '/' (so '1/s(s+1)' means 1/(s(s+1))), and delay factors exp(-T*s) / e^(-Ts).
 */
export function parseTf(text) {
  const toks = tokenize(text);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (v) => { if (toks[pos] && toks[pos].v === v) { pos++; return true; } return false; };
  const expect = (v) => { if (!eat(v)) throw new Error(`parseTf: expected '${v}' in "${text}"`); };

  // rational = {n, d, delay}
  const R = (n, d = [1], delay = 0) => ({ n, d, delay });
  const add = (a, b, sg) => {
    if (Math.abs(a.delay - b.delay) > 1e-12) throw new Error('parseTf: cannot add terms with different delays');
    const bn = sg < 0 ? polyNeg(b.n) : b.n;
    return R(polyAdd(polyMul(a.n, b.d), polyMul(bn, a.d)), polyMul(a.d, b.d), a.delay);
  };
  const mul = (a, b) => R(polyMul(a.n, b.n), polyMul(a.d, b.d), a.delay + b.delay);
  const div = (a, b) => {
    if (b.n.length === 1 && b.n[0] === 0) throw new Error('parseTf: division by zero');
    return R(polyMul(a.n, b.d), polyMul(a.d, b.n), a.delay - b.delay);
  };
  const startsAtom = (t) => t && (t.k === 'num' || t.k === 'id' || t.v === '(');

  function atom() {
    const t = toks[pos];
    if (!t) throw new Error(`parseTf: unexpected end of "${text}"`);
    if (t.k === 'num') { pos++; return R([t.v]); }
    if (t.v === '(') { pos++; const r = expr(); expect(')'); return r; }
    if (t.k === 'id') {
      if (t.v === 's' || t.v === 'S') { pos++; return R([1, 0]); }
      if (t.v === 'exp' || t.v === 'e') {
        pos++;
        let arg;
        if (t.v === 'exp') { expect('('); arg = expr(); expect(')'); }
        else { expect('^'); arg = unaryAtom(); }
        if (arg.d.length !== 1 && !(arg.d.length === 1)) throw new Error('parseTf: unsupported exponent');
        const n = polyScale(arg.n, 1 / arg.d[0]);
        const lin = n.length === 2 && Math.abs(n[1]) < 1e-14; // c*s + 0
        const zero = n.length === 1 && n[0] === 0;
        if (zero) return R([1]);
        if (!lin) throw new Error('parseTf: only exp(-T*s) delay factors are supported');
        return R([1], [1], -n[0]);
      }
      throw new Error(`parseTf: unknown identifier '${t.v}'`);
    }
    throw new Error(`parseTf: unexpected '${t.v}' in "${text}"`);
  }
  function unaryAtom() {
    if (eat('-')) { const a = power(); return R(polyNeg(a.n), a.d, a.delay); }
    if (eat('+')) return power();
    return power();
  }
  function power() {
    let a = atom();
    if (peek() && peek().v === '^') {
      pos++;
      let sg = 1;
      if (eat('-')) sg = -1; else eat('+');
      const t = toks[pos];
      if (!t || t.k !== 'num' || !Number.isInteger(t.v)) throw new Error('parseTf: exponent must be an integer');
      pos++;
      let r = R([1]);
      for (let i = 0; i < t.v; i++) r = mul(r, a);
      a = sg < 0 ? div(R([1]), r) : r;
    }
    return a;
  }
  function factor() { // juxtaposition chain
    let a = unaryAtom();
    while (startsAtom(peek())) a = mul(a, power());
    return a;
  }
  function term() {
    let a = factor();
    for (;;) {
      if (eat('*')) a = mul(a, factor());
      else if (eat('/')) a = div(a, factor());
      else return a;
    }
  }
  function expr() {
    let a = term();
    for (;;) {
      if (eat('+')) a = add(a, term(), 1);
      else if (eat('-')) a = add(a, term(), -1);
      else return a;
    }
  }
  const r = expr();
  if (pos < toks.length) throw new Error(`parseTf: unexpected '${toks[pos].v}' in "${text}"`);
  if (r.delay < -1e-12) throw new Error('parseTf: negative delay (non-causal)');
  return tf(r.n, r.d, Math.max(0, r.delay));
}

function tokenize(text) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z]+)|(.))/gy;
  let m;
  while (re.lastIndex < text.length && (m = re.exec(text))) {
    if (m[1] !== undefined) toks.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) {
      // split "es"/"e" glued forms like "2s" are handled by number-first; here identifiers are whole words
      toks.push({ k: 'id', v: m[2] });
    } else if (m[3] !== undefined && m[3].trim() !== '') toks.push({ k: 'op', v: m[3] });
  }
  return toks;
}
