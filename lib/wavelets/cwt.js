// Continuous wavelet transform: mother wavelets and a direct-convolution CWT.
//
// Conventions
//  - psi(t) returns a number (real wavelets) or [re, im] (complex wavelets).
//  - centerFreq is the peak frequency of |FT(psi)| in cycles per unit of t,
//    so a sinusoid of frequency f (cycles per unit time) is matched by scale
//    a = centerFreq / (f * dt) when samples are dt apart.
//  - support is the effective support [a, b] outside of which psi is neglected.
//  - Where possible wavelets are normalised to unit L2 norm.

const TWO_PI = 2 * Math.PI;

/** Numerically normalise a wavelet function to unit L2 norm (trapezoid rule). */
function l2norm(psi, complex, [a, b], h = 1e-3) {
  const n = Math.round((b - a) / h);
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const v = psi(a + i * h);
    const w = i === 0 || i === n ? 0.5 : 1;
    s += w * (complex ? v[0] * v[0] + v[1] * v[1] : v * v);
  }
  return Math.sqrt(s * h);
}

function normalised(raw, complex, support) {
  const c = 1 / l2norm(raw, complex, support);
  return complex ? (t) => { const v = raw(t); return [c * v[0], c * v[1]]; } : (t) => c * raw(t);
}

/** Polynomial coefficients (low to high) of d^n/dt^n exp(-t^2) / exp(-t^2). */
function gaussDerivPoly(n) {
  // P_{k+1} = P_k' - 2 t P_k
  let p = [1];
  for (let k = 0; k < n; k++) {
    const q = new Array(p.length + 1).fill(0);
    for (let i = 0; i < p.length; i++) {
      if (i > 0) q[i - 1] += i * p[i];
      q[i + 1] += -2 * p[i];
    }
    p = q;
  }
  return p;
}

/** Complex polynomial (arrays of [re,im], low to high) of d^n/dt^n exp(i t - t^2) / exp(i t - t^2). */
function cgaussDerivPoly(n) {
  // P_{k+1} = P_k' + g' P_k, g' = i - 2t
  let p = [[1, 0]];
  for (let k = 0; k < n; k++) {
    const q = Array.from({ length: p.length + 1 }, () => [0, 0]);
    for (let i = 0; i < p.length; i++) {
      if (i > 0) { q[i - 1][0] += i * p[i][0]; q[i - 1][1] += i * p[i][1]; }
      // times (i - 2t): i*(re+i im) = -im + i re
      q[i][0] += -p[i][1]; q[i][1] += p[i][0];
      q[i + 1][0] += -2 * p[i][0]; q[i + 1][1] += -2 * p[i][1];
    }
    p = q;
  }
  return p;
}

function makeGaus(n) {
  const poly = gaussDerivPoly(n);
  const support = [-6, 6];
  const raw = (t) => {
    let v = 0;
    for (let i = poly.length - 1; i >= 0; i--) v = v * t + poly[i];
    return v * Math.exp(-t * t);
  };
  return {
    id: `gaus${n}`, name: `Gaussian derivative ${n}`, complex: false, support,
    centerFreq: Math.sqrt(2 * n) / TWO_PI, psi: normalised(raw, false, support),
  };
}

function makeCgau(n) {
  const poly = cgaussDerivPoly(n);
  const support = [-6, 6];
  const raw = (t) => {
    let re = 0, im = 0;
    for (let i = poly.length - 1; i >= 0; i--) {
      const r = re * t + poly[i][0];
      im = im * t + poly[i][1];
      re = r;
    }
    const e = Math.exp(-t * t);
    const c = Math.cos(t), s = Math.sin(t);
    return [e * (re * c - im * s), e * (re * s + im * c)];
  };
  return {
    id: `cgau${n}`, name: `Complex Gaussian derivative ${n}`, complex: true, support,
    centerFreq: (1 + Math.sqrt(1 + 8 * n)) / 2 / TWO_PI, psi: normalised(raw, true, support),
  };
}

const MEXH_C = 2 / (Math.sqrt(3) * Math.pow(Math.PI, 0.25));
const CMOR_B = 1.5;
const CMOR_A = Math.pow(2 / (Math.PI * CMOR_B), 0.25);
const PAUL_M = 4;
const PAUL_C = Math.pow(2, PAUL_M) * factorial(PAUL_M) / Math.sqrt(Math.PI * factorial(2 * PAUL_M));
// Difference of Gaussians (sigma 1 and 2, equal integrals => zero mean).
const dogRaw = (t) => Math.exp(-t * t / 2) - 0.5 * Math.exp(-t * t / 8);
const DOG_SUPPORT = [-10, 10];

function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }

const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

export const CONTINUOUS = [
  {
    id: 'morlet', name: 'Morlet (real)', complex: false, support: [-4, 4], centerFreq: 5 / TWO_PI,
    psi: (t) => Math.exp(-t * t / 2) * Math.cos(5 * t),
  },
  {
    id: 'cmorlet', name: 'Complex Morlet (B=1.5, C=1)', complex: true, support: [-4, 4], centerFreq: 1,
    psi: (t) => {
      const e = CMOR_A * Math.exp(-t * t / CMOR_B);
      return [e * Math.cos(TWO_PI * t), e * Math.sin(TWO_PI * t)];
    },
  },
  {
    id: 'mexh', name: 'Mexican hat (Ricker)', complex: false, support: [-5, 5], centerFreq: Math.SQRT2 / TWO_PI,
    psi: (t) => MEXH_C * (1 - t * t) * Math.exp(-t * t / 2),
  },
  makeGaus(1), makeGaus(2), makeGaus(3), makeGaus(4),
  {
    id: 'paul', name: 'Paul (order 4)', complex: true, support: [-16, 16], centerFreq: PAUL_M / TWO_PI,
    psi: (t) => {
      // PAUL_C * i^m * (1 - i t)^-(m+1);  (1 - it)^-(m+1) = (1 + it)^(m+1) / (1 + t^2)^(m+1)
      const r = Math.hypot(1, t), th = Math.atan2(t, 1);
      const mag = PAUL_C * Math.pow(r, -(PAUL_M + 1));
      const ph = (PAUL_M + 1) * th + PAUL_M * Math.PI / 2;
      return [mag * Math.cos(ph), mag * Math.sin(ph)];
    },
  },
  {
    id: 'shannon', name: 'Complex Shannon (B=1, C=1)', complex: true, support: [-20, 20], centerFreq: 1,
    psi: (t) => {
      const s = sinc(t);
      return [s * Math.cos(TWO_PI * t), s * Math.sin(TWO_PI * t)];
    },
  },
  makeCgau(1), makeCgau(2),
  {
    id: 'haar-cont', name: 'Haar (continuous)', complex: false, support: [0, 1], centerFreq: 0.7421,
    psi: (t) => (t >= 0 && t < 0.5 ? 1 : t >= 0.5 && t < 1 ? -1 : 0),
  },
  {
    id: 'dog', name: 'Difference of Gaussians', complex: false, support: DOG_SUPPORT,
    centerFreq: Math.sqrt(Math.log(4) / 1.5) / TWO_PI, psi: normalised(dogRaw, false, DOG_SUPPORT),
  },
];

export function getContinuous(id) {
  const w = CONTINUOUS.find((c) => c.id === id);
  if (!w) throw new Error(`Unknown continuous wavelet: ${id}`);
  return w;
}

/**
 * W(a,b) = 1/sqrt(a) * sum_n x[n] conj(psi((n - j)/a)) dt  (b = sample j).
 * Scales are expressed in SAMPLES (psi is dilated by a samples); dt is the sampling
 * interval and only enters the integral weight and the pseudo-frequency
 * centerFreq / (a * dt) of a scale. A sinusoid of frequency f peaks at a = centerFreq / (f * dt).
 * Zero padding at the edges; the kernel is truncated to the wavelet's support.
 * Result arrays are row-major by scale (index s*n + j).
 */
export function cwt(signal, { wavelet, scales, dt = 1 } = {}) {
  const w = typeof wavelet === 'string' ? getContinuous(wavelet) : wavelet;
  if (!w) throw new Error('cwt: wavelet required');
  const n = signal.length;
  const nS = scales.length;
  const re = new Float32Array(nS * n);
  const im = w.complex ? new Float32Array(nS * n) : null;
  const mag = new Float32Array(nS * n);
  const x = Float64Array.from(signal);
  for (let s = 0; s < nS; s++) {
    const a = scales[s];
    // Kernel index k = m - j (sample offset); psi argument = k/a.
    const kLo = Math.max(-(n - 1), Math.floor(w.support[0] * a));
    const kHi = Math.min(n - 1, Math.ceil(w.support[1] * a));
    const len = kHi - kLo + 1;
    const kr = new Float64Array(len), ki = new Float64Array(len);
    const norm = dt / Math.sqrt(a);
    for (let q = 0; q < len; q++) {
      const v = w.psi((kLo + q) / a);
      if (w.complex) { kr[q] = v[0] * norm; ki[q] = -v[1] * norm; } else kr[q] = v * norm;
    }
    const row = s * n;
    for (let j = 0; j < n; j++) {
      const mLo = Math.max(0, j + kLo), mHi = Math.min(n - 1, j + kHi);
      let sr = 0, si = 0;
      for (let m = mLo; m <= mHi; m++) {
        const q = m - j - kLo;
        sr += x[m] * kr[q];
        if (w.complex) si += x[m] * ki[q];
      }
      re[row + j] = sr;
      if (im) im[row + j] = si;
      mag[row + j] = Math.hypot(sr, si);
    }
  }
  return { scales: Array.from(scales), n, dt, re, im, mag };
}
