// Real Fourier series fits of a function on one period.
//
// Convention (T = period, x0 = start of the sampling window, w(x) = 2 pi (x - x0) / T):
//   f(x) ~ a0/2 + sum_{k=1..N} [ a_k cos(k w(x)) + b_k sin(k w(x)) ]
//   a_k = (2/T) * integral_{x0}^{x0+T} f(x) cos(k w(x)) dx   (k >= 0, so a0/2 is the mean of f)
//   b_k = (2/T) * integral_{x0}^{x0+T} f(x) sin(k w(x)) dx
// Integrals use the midpoint rule on `samples` points, x_j = x0 + (j + 1/2) T / samples, which is
// exact for trigonometric polynomials of degree < samples/2 and never evaluates f exactly at a
// jump located at x0.
import * as C from './complex.js';

function makeFit(a0, a, b, period, x0, N) {
  const w = 2 * Math.PI / period;
  const fit = {
    a0, a, b, period, x0, N,
    /** Evaluate the truncated series at a real x. */
    evalReal(x) {
      const t = w * (x - x0);
      const cr = Math.cos(t);
      const ci = Math.sin(t);
      let c = 1;
      let s = 0;
      let sum = a0 / 2;
      for (let k = 0; k < N; k++) {
        const nc = c * cr - s * ci; // rotate by t: (c + i s) *= e^{it}
        s = c * ci + s * cr;
        c = nc;
        sum += a[k] * c + b[k] * s;
      }
      return sum;
    },
    /** Evaluate the same trigonometric polynomial at a complex z; returns [re, im]. */
    evalComplex(z) {
      const zz = Array.isArray(z) ? z : [z, 0];
      const t = C.scale(C.sub(zz, [x0, 0]), w);
      const E = C.exp(C.mul(C.I, t)); // e^{it}
      const Ei = C.div(C.ONE, E); // e^{-it}
      let Ek = C.ONE;
      let Eik = C.ONE;
      let sum = [a0 / 2, 0];
      for (let k = 0; k < N; k++) {
        Ek = C.mul(Ek, E);
        Eik = C.mul(Eik, Ei);
        const cosk = C.scale(C.add(Ek, Eik), 0.5);
        const sink = C.mul(C.sub(Ek, Eik), [0, -0.5]); // (E - E^-1) / (2i)
        sum = C.add(sum, C.add(C.scale(cosk, a[k]), C.scale(sink, b[k])));
      }
      return sum;
    },
  };
  return fit;
}

/**
 * Fit f over [x0, x0 + period) with N harmonics. Returns { a0, a:[a1..aN], b:[b1..bN], period, x0, N,
 * evalReal(x), evalComplex(z) } using the convention documented at the top of this file.
 */
export function fourierFit(f, { period, x0 = 0, N, samples = 4096 }) {
  const S = samples;
  // Tables of cos/sin(pi m / S), m = 0..2S-1 (angle 2 pi k (j + 1/2) / S = pi * k (2j + 1) / S).
  const cosT = new Float64Array(2 * S);
  const sinT = new Float64Array(2 * S);
  for (let m = 0; m < 2 * S; m++) {
    cosT[m] = Math.cos((Math.PI * m) / S);
    sinT[m] = Math.sin((Math.PI * m) / S);
  }
  const y = new Float64Array(S);
  let mean = 0;
  for (let j = 0; j < S; j++) {
    y[j] = f(x0 + ((j + 0.5) * period) / S);
    mean += y[j];
  }
  const a = new Array(N).fill(0);
  const b = new Array(N).fill(0);
  for (let k = 1; k <= N; k++) {
    let sc = 0;
    let ss = 0;
    for (let j = 0; j < S; j++) {
      const idx = (k * (2 * j + 1)) % (2 * S);
      sc += y[j] * cosT[idx];
      ss += y[j] * sinT[idx];
    }
    a[k - 1] = (2 * sc) / S;
    b[k - 1] = (2 * ss) / S;
  }
  return makeFit((2 * mean) / S, a, b, period, x0, N);
}

/** Truncate a fit to its first n harmonics (n <= fit.N), without refitting. */
export function fourierPartial(fit, n) {
  const m = Math.max(0, Math.min(n, fit.N));
  return makeFit(fit.a0, fit.a.slice(0, m), fit.b.slice(0, m), fit.period, fit.x0, m);
}
