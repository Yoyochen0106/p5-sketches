// Gibbs-phenomenon controls for Fourier partial sums: summation windows ("sigma factors") applied to
// the coefficients of a fit from lib/fourier.js, plus a measurement of the overshoot at a jump.
//
//   S_N^sigma(x) = a0/2 + sum_{k=1..N} sigma_k [a_k cos(k w) + b_k sin(k w)]
//
// With M = N + 1 and sigma_0 = 1 for every window:
//   none       sigma_k = 1                              plain partial sum (Dirichlet kernel, 8.95 % overshoot)
//   fejer      sigma_k = 1 - k/M                        Cesaro mean, positive kernel -> no overshoot
//   lanczos    sigma_k = sinc(k/M)                      Lanczos sigma factors (mild overshoot, sharper edge)
//   hann       sigma_k = (1 + cos(pi k/M)) / 2          Hann (raised cosine with 0.5 / 0.5)
//   jackson    Jackson kernel (Weisse et al., KPM)      positive kernel -> no overshoot, near-optimal width
//   raisedcos  sigma_k = 0.54 + 0.46 cos(pi k/M)        generalised raised cosine (Hamming)
import * as C from './complex.js';

export const WINDOWS = [
  { id: 'none', label: 'none (plain partial sum)' },
  { id: 'fejer', label: 'Fejér (Cesàro)' },
  { id: 'lanczos', label: 'Lanczos σ' },
  { id: 'hann', label: 'Hann' },
  { id: 'jackson', label: 'Jackson' },
  { id: 'raisedcos', label: 'Raised cosine (Hamming)' },
];

/** The classical Gibbs constant: overshoot of the plain partial sum as a fraction of the jump, Si(pi)/pi - 1/2. */
export const GIBBS_FRACTION = 0.08948987223608357;

/** Factors sigma_0..sigma_N (an array of length N + 1, sigma_0 = 1) of the named summation window. */
export function windowFactors(name, N) {
  const n = Math.max(0, Math.floor(N));
  const M = n + 1;
  const out = new Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const t = (Math.PI * k) / M;
    switch (name) {
      case 'none':
      case undefined:
      case null:
        out[k] = 1;
        break;
      case 'fejer':
        out[k] = 1 - k / M;
        break;
      case 'lanczos':
        out[k] = k === 0 ? 1 : Math.sin(t) / t;
        break;
      case 'hann':
        out[k] = 0.5 * (1 + Math.cos(t));
        break;
      case 'raisedcos':
        out[k] = 0.54 + 0.46 * Math.cos(t);
        break;
      case 'jackson': {
        const tt = (Math.PI * k) / (M + 1);
        out[k] = ((M - k + 1) * Math.cos(tt) + Math.sin(tt) / Math.tan(Math.PI / (M + 1))) / (M + 1);
        break;
      }
      default:
        throw new Error(`fourier-windows: unknown window "${name}"`);
    }
  }
  return out;
}

/**
 * Apply a summation window to a fit of the shape produced by lib/fourier.js. Returns a NEW fit with the same
 * fields (a0, a, b, period, x0, N, evalReal, evalComplex) whose coefficients are multiplied by sigma_k.
 */
export function applyWindow(fit, name) {
  const { a0, period, x0, N } = fit;
  const s = windowFactors(name, N);
  const a = fit.a.map((v, i) => v * s[i + 1]);
  const b = fit.b.map((v, i) => v * s[i + 1]);
  const w = (2 * Math.PI) / period;
  return {
    a0, a, b, period, x0, N, window: name || 'none',
    evalReal(x) {
      const t = w * (x - x0);
      const cr = Math.cos(t);
      const ci = Math.sin(t);
      let c = 1;
      let sn = 0;
      let sum = a0 / 2;
      for (let k = 0; k < N; k++) {
        const nc = c * cr - sn * ci;
        sn = c * ci + sn * cr;
        c = nc;
        sum += a[k] * c + b[k] * sn;
      }
      return sum;
    },
    evalComplex(z) {
      const zz = Array.isArray(z) ? z : [z, 0];
      const t = C.scale(C.sub(zz, [x0, 0]), w);
      const E = C.exp(C.mul(C.I, t));
      const Ei = C.div(C.ONE, E);
      let Ek = C.ONE;
      let Eik = C.ONE;
      let sum = [a0 / 2, 0];
      for (let k = 0; k < N; k++) {
        Ek = C.mul(Ek, E);
        Eik = C.mul(Eik, Ei);
        const cosk = C.scale(C.add(Ek, Eik), 0.5);
        const sink = C.mul(C.sub(Ek, Eik), [0, -0.5]);
        sum = C.add(sum, C.add(C.scale(cosk, a[k]), C.scale(sink, b[k])));
      }
      return sum;
    },
  };
}

/**
 * Jump discontinuities of the built-in functions that can show the Gibbs phenomenon: the x positions of ONE
 * representative jump (the other jumps are periodic images). The jump size is measured numerically.
 */
export const JUMP_POINTS = { square: 0, saw: 0.5, step: 0 };

/**
 * Measured overshoot of `S` (a function of x) at the jump of `f` located at xj. The jump is the difference of the
 * one-sided limits of f; the overshoot is the largest excursion of S beyond f itself on the high side of the jump
 * (resp. below f on the low side) within `reach` of xj, as a fraction of |jump| (0.0895 for the plain Fourier partial sum with large N).
 * Returns { jump, overshoot (fraction), left, right, level } or null if f is continuous at xj.
 * `level` is the y value of the theoretical plain-Gibbs top (plateau + 0.0895 |jump|) on the overshooting side.
 */
export function measureOvershoot(S, f, xj, reach, samples = 1500) {
  const eps = Math.min(1e-9, reach * 1e-6);
  const fl = f(xj - eps);
  const fr = f(xj + eps);
  const jump = fr - fl;
  if (!Number.isFinite(jump) || Math.abs(jump) < 1e-6) return null;
  const sgn = Math.sign(jump);
  let right = 0;
  let left = 0;
  for (let i = 1; i <= samples; i++) {
    const d = (reach * i) / samples;
    right = Math.max(right, (sgn * (S(xj + d) - f(xj + d))) / Math.abs(jump));
    left = Math.max(left, (sgn * (f(xj - d) - S(xj - d))) / Math.abs(jump));
  }
  const overshoot = Math.max(right, left, 0);
  const rightSide = right >= left;
  const level = rightSide ? fr + sgn * GIBBS_FRACTION * Math.abs(jump) : fl - sgn * GIBBS_FRACTION * Math.abs(jump);
  return { jump, overshoot, left, right, level, side: rightSide ? 'right' : 'left' };
}
