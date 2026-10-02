/**
 * Discrete-time control: s -> z conversion, z-domain transfer functions, difference-equation simulation,
 * z-plane mapping helpers and sampling/aliasing utilities.
 *
 * A z-domain TF is {num, den, Ts}: polynomials in z (highest power first, proper: deg num <= deg den), sample time Ts.
 * H(z) = num(z)/den(z); the delay of k samples is z^-k. Create with tfz().
 *
 * c2d(G, Ts, method) methods: 'zoh' (step invariant, exact for piecewise-constant input), 'tustin' (bilinear, optional
 * prewarp at opts.wc), 'forward' (s = (z-1)/Ts), 'backward' (s = (z-1)/(Ts z)), 'matched' (pole-zero matching).
 * A transport delay T of the continuous plant is converted to round(T/Ts) whole samples (fraction dropped).
 */
import { tf, polyAdd, polyMul, polyScale, polyTrim, polyPow, polyRoots, polyEvalC, polyFromRoots, polyDegree, toTf, evalTf, dcGain } from './tf.js';
import { tf2ss, ss2tf, ss } from './ss.js';
import { zohMatrices } from './_mat.js';

const cabs = (z) => Math.hypot(z[0], z[1]);
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };

/** Create a z-domain transfer function; the denominator is normalised to a monic polynomial. */
export function tfz(num, den, Ts) {
  const n = polyTrim(Array.isArray(num) ? num : [num]);
  const d = polyTrim(Array.isArray(den) ? den : [den]);
  const k = d[0];
  return { num: polyScale(n, 1 / k), den: polyScale(d, 1 / k), Ts };
}

/** Poles / zeros of a z-domain TF as [re, im]. */
export const zPoles = (H) => polyRoots(H.den);
export const zZeros = (H) => polyRoots(H.num);
/** H(z) at complex z. */
export function evalZ(H, z) {
  return cdiv(polyEvalC(H.num, z), polyEvalC(H.den, z));
}
/** H(e^{jwTs}). */
export const freqResponseZ = (H, w) => evalZ(H, [Math.cos(w * H.Ts), Math.sin(w * H.Ts)]);
/** DC gain H(1) (Infinity for a pole at z = 1). */
export function dcGainZ(H) {
  const d = polyEvalC(H.den, [1, 0])[0], n = polyEvalC(H.num, [1, 0])[0];
  if (Math.abs(d) < 1e-12 * Math.max(1, ...H.den.map(Math.abs))) return Math.abs(n) < 1e-12 ? NaN : (n / d > 0 ? Infinity : -Infinity);
  return n / d;
}
/** All poles strictly inside the unit circle (|z| < 1 - tol). */
export const isStableZ = (H, tol = 1e-9) => zPoles(H).every((p) => cabs(p) < 1 - tol);
/** Largest pole magnitude (spectral radius). */
export const spectralRadius = (H) => Math.max(0, ...zPoles(H).map(cabs));

// ------------------------------------------------------------------ s -> z conversion

/** den^n * p(num/den) = sum a_k num^k den^(n-k): substitution s = ns/ds into polynomial p of degree <= n. */
function substitute(p, ns, ds, n) {
  const m = p.length - 1;
  let out = [0];
  for (let i = 0; i <= m; i++) {
    const k = m - i; // power of s
    out = polyAdd(out, polyScale(polyMul(polyPow(ns, k), polyPow(ds, n - k)), p[i]));
  }
  return out;
}

/**
 * Convert a continuous TF to a z-domain TF with sample time Ts.
 * @param {object} G continuous TF {num, den, delay}
 * @param {number} Ts sample time (s)
 * @param {'zoh'|'tustin'|'forward'|'backward'|'matched'} method
 * @param {{wc?:number, wMatch?:number}} opts wc: prewarp frequency for 'tustin' (rad/s); wMatch: gain-matching frequency for 'matched'
 */
export function c2d(G, Ts, method = 'zoh', opts = {}) {
  G = toTf(G);
  const d = Math.round((G.delay || 0) / Ts);
  const delayDen = (H) => tfz(H.num, polyMul(H.den, d ? [1, ...new Array(d).fill(0)] : [1]), Ts);
  const n = Math.max(polyDegree(G.num), polyDegree(G.den));
  let H;
  if (method === 'zoh') {
    if (polyDegree(G.num) > polyDegree(G.den)) throw new Error('c2d: improper system');
    const S = tf2ss(tf(G.num, G.den));
    if (S.n === 0) H = tfz(G.num.map((v) => v / G.den[0]), [1], Ts);
    else {
      const { Ad, Bd } = zohMatrices(S.A, S.B, Ts);
      const Dd = ss(Ad, Bd, S.C, S.D);
      const T = ss2tf(Dd);
      H = tfz(T.num, T.den, Ts);
    }
  } else if (method === 'tustin' || method === 'forward' || method === 'backward') {
    let ns, ds;
    if (method === 'tustin') {
      const c = opts.wc ? opts.wc / Math.tan((opts.wc * Ts) / 2) : 2 / Ts;
      ns = [c, -c]; ds = [1, 1];
    } else if (method === 'forward') { ns = [1 / Ts, -1 / Ts]; ds = [1]; }
    else { ns = [1 / Ts, -1 / Ts]; ds = [1, 0]; }
    H = tfz(substitute(G.num, ns, ds, n), substitute(G.den, ns, ds, n), Ts);
  } else if (method === 'matched') {
    const zs = polyRoots(G.num).map((r) => expC(r, Ts));
    const ps = polyRoots(G.den).map((r) => expC(r, Ts));
    const extra = Math.max(0, polyDegree(G.den) - polyDegree(G.num) - 1);
    for (let i = 0; i < extra; i++) zs.push([-1, 0]);
    const H0 = tfz(polyFromRoots(zs, 1), polyFromRoots(ps, 1), Ts);
    let K;
    const g0 = dcGain(G), h0 = dcGainZ(H0);
    if (Number.isFinite(g0) && Number.isFinite(h0) && Math.abs(h0) > 1e-12) K = g0 / h0;
    else {
      const w = opts.wMatch ?? (0.1 * Math.PI) / Ts;
      K = cabs(evalTf(G, [0, w])) / cabs(freqResponseZ(H0, w));
    }
    H = tfz(polyScale(H0.num, K), H0.den, Ts);
  } else throw new Error(`c2d: unknown method '${method}'`);
  return d ? delayDen(H) : H;
}

const expC = (s, Ts) => { const m = Math.exp(s[0] * Ts); return [m * Math.cos(s[1] * Ts), m * Math.sin(s[1] * Ts)]; };

/** Discrete-time loop G(z) C(z) etc.: series connection of z-domain TFs (same Ts). */
export function seriesZ(...Hs) {
  let num = [1], den = [1];
  for (const H of Hs) { num = polyMul(num, H.num); den = polyMul(den, H.den); }
  return tfz(num, den, Hs[0].Ts);
}
/** Unity (or H) negative feedback in the z domain: G / (1 + G H). */
export function feedbackZ(G, H = null) {
  const Hn = H ? H.num : [1], Hd = H ? H.den : [1];
  return tfz(polyMul(G.num, Hd), polyAdd(polyMul(G.den, Hd), polyMul(G.num, Hn)), G.Ts);
}

// ------------------------------------------------------------------ difference equations / simulation

/**
 * Difference-equation coefficients of H(z): a0 y[k] + a1 y[k-1] + ... = b0 u[k] + b1 u[k-1] + ...
 * (num padded to the order of den, so b_i multiplies u[k-i]; leading b's are zero for strictly proper H).
 */
export function differenceCoefficients(H) {
  const n = H.den.length - 1;
  const b = new Array(n + 1).fill(0);
  H.num.forEach((c, i) => { b[n + 1 - H.num.length + i] = c; });
  return { a: H.den.slice(), b };
}

/** Text of the difference equation, e.g. "y[k] = 0.5 y[k-1] + 0.2 u[k-1]". */
export function formatDifferenceEquation(H, digits = 4) {
  const { a, b } = differenceCoefficients(H);
  const num = (x) => String(Number(Math.abs(x).toPrecision(digits)));
  const terms = [];
  b.forEach((c, i) => { if (c !== 0) terms.push([c, `u[k${i ? '-' + i : ''}]`]); });
  a.forEach((c, i) => { if (i > 0 && c !== 0) terms.push([-c / a[0], `y[k-${i}]`]); });
  if (!terms.length) return 'y[k] = 0';
  return 'y[k] = ' + terms.map(([c, v], i) => `${i ? (c < 0 ? ' - ' : ' + ') : c < 0 ? '-' : ''}${Math.abs(Math.abs(c) - 1) < 1e-12 ? '' : num(c) + ' '}${v}`).join('');
}

/** Simulate y = H u for an input sequence u (zero initial conditions). Returns a Float64Array. */
export function simulateDifference(H, u) {
  const { a, b } = differenceCoefficients(H);
  const n = a.length - 1;
  const y = new Float64Array(u.length);
  for (let k = 0; k < u.length; k++) {
    let acc = 0;
    for (let i = 0; i <= n; i++) if (k - i >= 0) acc += b[i] * u[k - i];
    for (let i = 1; i <= n; i++) if (k - i >= 0) acc -= a[i] * y[k - i];
    y[k] = acc / a[0];
  }
  return y;
}
/** Unit step response over N samples: {k, t, y}. */
export function stepResponseZ(H, N = 50, amp = 1) {
  const u = new Float64Array(N).fill(amp);
  return { k: Array.from({ length: N }, (_, i) => i), t: Float64Array.from({ length: N }, (_, i) => i * H.Ts), y: simulateDifference(H, u) };
}
/** Unit impulse (Kronecker delta) response over N samples. */
export function impulseResponseZ(H, N = 50) {
  const u = new Float64Array(N); u[0] = 1;
  return { k: Array.from({ length: N }, (_, i) => i), t: Float64Array.from({ length: N }, (_, i) => i * H.Ts), y: simulateDifference(H, u) };
}

// ------------------------------------------------------------------ z-plane mapping

/** z = e^{sTs}. */
export const sToZ = (s, Ts) => expC(s, Ts);
/** s = ln(z)/Ts (principal branch: |Im s| <= pi/Ts). */
export const zToS = (z, Ts) => [Math.log(cabs(z)) / Ts, Math.atan2(z[1], z[0]) / Ts];
/** Map the poles of a continuous TF through z = e^{sTs}. */
export const polesToZ = (poles, Ts) => poles.map((p) => expC(p, Ts));

/** z for a given s under an approximation method: 'exact' | 'tustin' | 'forward' | 'backward'. */
export function mapS(s, Ts, method = 'exact') {
  const one = [1, 0];
  if (method === 'exact') return expC(s, Ts);
  if (method === 'forward') return [1 + s[0] * Ts, s[1] * Ts];
  if (method === 'backward') return cdiv(one, [1 - s[0] * Ts, -s[1] * Ts]);
  if (method === 'tustin') return cdiv([1 + 0.5 * s[0] * Ts, 0.5 * s[1] * Ts], [1 - 0.5 * s[0] * Ts, -0.5 * s[1] * Ts]);
  throw new Error(`mapS: unknown method '${method}'`);
}

/** Image of the imaginary axis s = jw, w in [0, wMax] under a method: array of z points (shows where each method maps stability). */
export function imagAxisImage(Ts, method = 'exact', wMax = Math.PI / Ts, n = 200) {
  return Array.from({ length: n + 1 }, (_, i) => mapS([0, (wMax * i) / n], Ts, method));
}

/**
 * Image of the constant-damping line s = -zeta wn + j wn sqrt(1-zeta^2), 0 <= wn <= wnMax (default: up to the Nyquist
 * frequency, wd = pi/Ts) under z = e^{sTs}: a logarithmic spiral. Returns z points.
 */
export function dampingLineToZ(zeta, Ts, opts = {}) {
  const sq = Math.sqrt(Math.max(0, 1 - zeta * zeta));
  const wnMax = opts.wnMax ?? (sq > 1e-9 ? Math.PI / (Ts * sq) : 10 / Ts);
  const n = opts.n ?? 120;
  return Array.from({ length: n + 1 }, (_, i) => { const wn = (wnMax * i) / n; return expC([-zeta * wn, wn * sq], Ts); });
}
/** Image of the natural-frequency arc |s| = wn, zeta from zeta0 to zeta1 (default 0..1): z points. */
export function wnArcToZ(wn, Ts, opts = {}) {
  const n = opts.n ?? 60, z0 = opts.zeta0 ?? 0, z1 = opts.zeta1 ?? 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const z = z0 + ((z1 - z0) * i) / n;
    return expC([-z * wn, wn * Math.sqrt(Math.max(0, 1 - z * z))], Ts);
  });
}
/** Image of the vertical line Re s = -sigma, w from 0 to the Nyquist frequency: part of a circle of radius e^{-sigma Ts}. */
export function sigmaLineToZ(sigma, Ts, n = 120) {
  return Array.from({ length: n + 1 }, (_, i) => expC([-sigma, ((Math.PI / Ts) * i) / n], Ts));
}

/** Specs of a z-plane pole: s = ln(z)/Ts -> {zeta, wn, sigma, wd, magnitude, samplesPerCycle, settlingSamples2}. */
export function zPoleSpecs(z, Ts) {
  const s = zToS(z, Ts);
  const wn = cabs(s);
  const m = cabs(z);
  return {
    s, zeta: wn ? -s[0] / wn : NaN, wn, sigma: -s[0], wd: Math.abs(s[1]), magnitude: m,
    samplesPerCycle: Math.abs(s[1]) > 1e-12 ? (2 * Math.PI) / (Math.abs(s[1]) * Ts) : Infinity,
    settlingSamples2: m < 1 ? Math.log(0.02) / Math.log(m) : Infinity,
  };
}

// ------------------------------------------------------------------ sampling

/** Sampling frequency fs = 1/Ts (Hz) and Nyquist frequency fs/2. */
export const samplingFrequency = (Ts) => 1 / Ts;
export const nyquistFrequency = (Ts) => 0.5 / Ts;
/** Nyquist frequency in rad/s: pi/Ts. */
export const nyquistOmega = (Ts) => Math.PI / Ts;

/**
 * Apparent (aliased) frequency in [0, fs/2] of a tone f sampled at fs (same units for f and fs):
 * |f - fs * round(f/fs)|.
 */
export function aliasFrequency(f, fs) {
  return Math.abs(f - fs * Math.round(f / fs));
}
/** Sample a sinusoid amp*sin(2 pi f t + phase) at rate fs: Float64Array of N samples. */
export function sampleSine(f, fs, N, { amp = 1, phase = 0 } = {}) {
  return Float64Array.from({ length: N }, (_, k) => amp * Math.sin(2 * Math.PI * f * (k / fs) + phase));
}
/** Frequency-warping relation of the bilinear transform: continuous w_a = (2/Ts) tan(w_d Ts / 2) for digital w_d. */
export const tustinWarp = (wd, Ts) => (2 / Ts) * Math.tan((wd * Ts) / 2);
export const tustinUnwarp = (wa, Ts) => (2 / Ts) * Math.atan((wa * Ts) / 2);
/** Rule of thumb: sample 10-30 times faster than the closed-loop bandwidth (returns the Ts range [fast, slow]). */
export function suggestedSampleTime(bandwidth) {
  return { min: (2 * Math.PI) / (30 * bandwidth), max: (2 * Math.PI) / (10 * bandwidth) };
}
