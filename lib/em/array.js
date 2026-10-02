// Antenna array theory: element patterns, array factors, tapers, pattern analysis. Pure functions.
//
// Conventions
//   * A linear array lies on the z axis, elements n = 0..N-1 with spacing d (in wavelengths) and real
//     amplitude weights w_n. theta is measured from the array axis (theta = 90 deg is broadside).
//   * Array factor AF(psi) = sum_n w_n exp(j n psi),   psi = 2 pi d cos(theta) + beta,
//     where beta is the progressive phase. So AF is the DISCRETE-TIME FOURIER TRANSFORM of the weights:
//     spatial frequency psi <-> angle. The visible region is psi in [beta - 2 pi d, beta + 2 pi d].
//   * Planar arrays lie in the xy plane (boresight = +z); the array factor is the product of two linear ones.
import { fft, dft } from '../fft.js';

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------------------------
// Element patterns (field amplitude, normalised to a maximum of 1)

export const ELEMENT_TYPES = [
  { id: 'iso', label: 'isotropic', directivity: 1 },
  { id: 'short', label: 'short dipole  sin(theta)', directivity: 1.5 },
  { id: 'half', label: 'half-wave dipole  cos(pi/2 cos theta)/sin theta', directivity: 1.6409 },
  { id: 'patch', label: 'patch  cos(theta)', directivity: null },
];

/**
 * Field pattern of a single element versus the angle theta from ITS axis (dipoles) or from its
 * boresight (patch: cos(theta) for theta < 90 deg, zero behind the ground plane).
 */
export function elementPattern(type, theta) {
  switch (type) {
    case 'short': return Math.abs(Math.sin(theta));
    case 'half': {
      const s = Math.sin(theta);
      if (Math.abs(s) < 1e-9) return 0;
      return Math.abs(Math.cos((Math.PI / 2) * Math.cos(theta)) / s);
    }
    case 'patch': return Math.max(0, Math.cos(theta));
    default: return 1;
  }
}

/** Element pattern used inside a linear array along z (dipoles parallel to the array axis). */
export function linearElement(type, theta) {
  return type === 'short' || type === 'half' ? elementPattern(type, theta) : 1;
}

/** Element field of a planar-array element: iso, patch (boresight +z) or a short dipole along x. */
export function planarElement(type, theta, phi) {
  if (type === 'patch') return Math.max(0, Math.cos(theta));
  if (type === 'dipole') {
    const sx = Math.sin(theta) * Math.cos(phi);
    return Math.sqrt(Math.max(0, 1 - sx * sx));
  }
  return 1;
}

// ---------------------------------------------------------------------------------------------
// Linear array factor

/** psi = 2 pi d cos(theta) + beta. */
export const psiOf = (d, theta, beta) => TWO_PI * d * Math.cos(theta) + beta;
/** Progressive phase that points the main beam at theta0 (radians from the axis). */
export const steeringBeta = (d, theta0) => -TWO_PI * d * Math.cos(theta0);

/** Complex array factor sum w_n exp(j n psi). */
export function afComplex(w, psi) {
  let re = 0, im = 0;
  for (let n = 0; n < w.length; n++) { re += w[n] * Math.cos(n * psi); im += w[n] * Math.sin(n * psi); }
  return [re, im];
}
/** |AF(psi)|. */
export function afMag(w, psi) {
  const a = afComplex(w, psi);
  return Math.hypot(a[0], a[1]);
}

/**
 * Magnitude of the weights' DTFT over psi in [-pi, pi), by zero-padded FFT of size M (power of two).
 * This is the same function as |AF(psi)|: the sketch plots it next to the polar pattern.
 * @returns {{psi: Float64Array, mag: Float64Array}}
 */
export function weightSpectrum(w, M = 1024) {
  const re = new Float64Array(M), im = new Float64Array(M);
  for (let n = 0; n < Math.min(w.length, M); n++) re[n] = w[n];
  fft(re, im);
  const psi = new Float64Array(M), mag = new Float64Array(M);
  // fftshift; |AF(psi)| = |X(-psi)| (conjugate symmetric for real weights, so X(psi) works too)
  for (let k = 0; k < M; k++) {
    const src = (k + M / 2) % M; // bin of psi = TWO_PI * (k - M/2) / M
    psi[k] = (TWO_PI * (k - M / 2)) / M;
    mag[k] = Math.hypot(re[src], im[src]);
  }
  return { psi, mag };
}

/**
 * Samples the pattern |AF(theta)| |E(theta)| on n + 1 uniform angles in [0, pi].
 * @returns {{theta: Float64Array, mag: Float64Array, max: number}} mag is normalised to a maximum of 1
 */
export function sampleLinear(w, d, beta, elem = 'iso', n = 720) {
  const theta = new Float64Array(n + 1), mag = new Float64Array(n + 1);
  let max = 0;
  for (let i = 0; i <= n; i++) {
    const th = (Math.PI * i) / n;
    theta[i] = th;
    mag[i] = afMag(w, psiOf(d, th, beta)) * linearElement(elem, th);
    if (mag[i] > max) max = mag[i];
  }
  if (max > 0) for (let i = 0; i <= n; i++) mag[i] /= max;
  return { theta, mag, max };
}

/** 20 log10(x) with a floor (dB). */
export const toDb = (x, floor = -80) => (x > 0 ? Math.max(floor, 20 * Math.log10(x)) : floor);

/**
 * Pattern analysis from sampled data (see sampleLinear): peaks, sidelobe level, HPBW, nulls, directivity.
 * Angles in radians; levels in dB relative to the global maximum.
 */
export function analyzePattern(samples, { nullFloorDb = -35 } = {}) {
  const { theta, mag } = samples;
  const n = theta.length;
  // local maxima (plateaus count once)
  const peaks = [];
  for (let i = 0; i < n; i++) {
    const l = i > 0 ? mag[i - 1] : -1, r = i < n - 1 ? mag[i + 1] : -1;
    if (mag[i] > 1e-6 && mag[i] >= l && mag[i] > r && !(i > 0 && mag[i] === l && peaks.length && peaks[peaks.length - 1].i === i - 1)) {
      peaks.push({ i, theta: theta[i], db: toDb(mag[i]) });
    }
  }
  let main = peaks.length ? peaks.reduce((a, b) => (b.db > a.db ? b : a)) : { i: 0, theta: 0, db: 0 };
  const others = peaks.filter((p) => p !== main).sort((a, b) => b.db - a.db);
  const sllDb = others.length ? others[0].db : -Infinity;
  // half-power points (-3.0103 dB in power = 1/sqrt(2) in field) around the main lobe
  const half = Math.SQRT1_2;
  let lo = null, hi = null;
  for (let i = main.i; i > 0; i--) {
    if (mag[i - 1] < half && mag[i] >= half) { lo = theta[i - 1] + ((half - mag[i - 1]) / (mag[i] - mag[i - 1])) * (theta[i] - theta[i - 1]); break; }
  }
  for (let i = main.i; i < n - 1; i++) {
    if (mag[i + 1] < half && mag[i] >= half) { hi = theta[i] + ((mag[i] - half) / (mag[i] - mag[i + 1])) * (theta[i + 1] - theta[i]); break; }
  }
  let hpbw = null, edge = false;
  if (lo !== null && hi !== null) hpbw = hi - lo;
  else if (lo !== null) { hpbw = 2 * (main.theta - lo); edge = true; }
  else if (hi !== null) { hpbw = 2 * (hi - main.theta); edge = true; }
  // nulls: local minima deeper than the floor
  const nulls = [];
  for (let i = 1; i < n - 1; i++) {
    if (mag[i] <= mag[i - 1] && mag[i] < mag[i + 1] && toDb(mag[i]) < nullFloorDb) nulls.push(theta[i]);
  }
  // grating lobes: other maxima within 0.5 dB of the main one
  const grating = others.filter((p) => p.db > -0.5);
  return {
    peaks, main, mainTheta: main.theta, sllDb, hpbw, hpbwEdge: edge, nulls, grating,
    ...directivityFromSamples(samples),
  };
}

/** Directivity of a pattern body of revolution: D = 2 Fmax^2 / integral F^2 sin(theta) dtheta. */
export function directivityFromSamples(samples) {
  const { theta, mag } = samples;
  let s = 0;
  for (let i = 1; i < theta.length; i++) {
    const a = mag[i - 1] * mag[i - 1] * Math.sin(theta[i - 1]);
    const b = mag[i] * mag[i] * Math.sin(theta[i]);
    s += 0.5 * (a + b) * (theta[i] - theta[i - 1]);
  }
  const D = s > 0 ? 2 / s : Infinity;
  return { directivity: D, directivityDbi: 10 * Math.log10(D) };
}

/** Analytic nulls of a uniform array: psi = 2 pi m / N (m not a multiple of N). Returns theta (rad), ascending. */
export function uniformNulls(N, d, beta) {
  const out = [];
  for (let m = -Math.ceil(N * (d + 1)) - 2; m <= Math.ceil(N * (d + 1)) + 2; m++) {
    if (m % N === 0) continue;
    const c = ((TWO_PI * m) / N - beta) / (TWO_PI * d);
    if (Math.abs(c) <= 1) out.push(Math.acos(c));
  }
  return out.sort((a, b) => a - b);
}

/** Angles (rad) of the main beam and its grating lobes: cos(theta) = (2 pi m - beta)/(2 pi d), |cos| <= 1. */
export function gratingAngles(d, beta) {
  const out = [];
  for (let m = -10; m <= 10; m++) {
    const c = (TWO_PI * m - beta) / (TWO_PI * d);
    if (Math.abs(c) <= 1 + 1e-12) out.push({ m, theta: Math.acos(Math.max(-1, Math.min(1, c))) });
  }
  return out;
}

/** Spacing (wavelengths) below which no grating lobe appears when steering to theta0: d < 1/(1 + |cos theta0|). */
export const maxSpacingNoGrating = (theta0) => 1 / (1 + Math.abs(Math.cos(theta0)));

// ---------------------------------------------------------------------------------------------
// Weights (amplitude tapers), all normalised to a maximum of 1

const normMax = (a) => {
  let m = 0;
  for (const v of a) if (Math.abs(v) > m) m = Math.abs(v);
  return m > 0 ? Float64Array.from(a, (v) => v / m) : Float64Array.from(a);
};

export function uniformWeights(N) { return new Float64Array(N).fill(1); }

/** Binomial (Pascal triangle) weights: no sidelobes when d <= lambda/2. */
export function binomialWeights(N) {
  const w = new Float64Array(N);
  w[0] = 1;
  for (let r = 1; r < N; r++) for (let k = r; k > 0; k--) w[k] += w[k - 1];
  return normMax(w);
}

/** Dolph-Chebyshev weights for sidelobes sllDb below the main lobe (sllDb > 0). */
export function chebyshevWeights(N, sllDb = 30) {
  if (N <= 1) return Float64Array.of(1);
  if (N === 2) return Float64Array.of(1, 1);
  const order = N - 1;
  const R = 10 ** (Math.max(1, sllDb) / 20);
  const x0 = Math.cosh(Math.acosh(R) / order);
  const odd = N % 2 === 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const x = x0 * Math.cos((Math.PI * k) / N);
    let T;
    if (Math.abs(x) <= 1) T = Math.cos(order * Math.acos(x));
    else if (x > 1) T = Math.cosh(order * Math.acosh(x));
    else T = (order % 2 ? -1 : 1) * Math.cosh(order * Math.acosh(-x));
    if (odd) { re[k] = T; } else { re[k] = T * Math.cos((Math.PI * k) / N); im[k] = T * Math.sin((Math.PI * k) / N); }
  }
  const X = dft(re, im).re;
  let w;
  if (odd) {
    const n = (N + 1) / 2;
    w = [...Array.from(X.slice(1, n)).reverse(), ...Array.from(X.slice(0, n))];
  } else {
    const n = N / 2 + 1;
    w = [...Array.from(X.slice(1, n)).reverse(), ...Array.from(X.slice(1, n))];
  }
  return normMax(w);
}

/** Taylor (n-bar) weights for a sidelobe level sllDb > 0. */
export function taylorWeights(N, sllDb = 30, nbar = 4) {
  if (N <= 1) return Float64Array.of(1);
  nbar = Math.max(2, Math.min(Math.floor(nbar), N));
  const B = 10 ** (sllDb / 20);
  const A = Math.log(B + Math.sqrt(B * B - 1)) / Math.PI;
  const s2 = (nbar * nbar) / (A * A + (nbar - 0.5) ** 2);
  const Fm = [];
  for (let m = 1; m < nbar; m++) {
    let num = (m % 2 === 1 ? 1 : -1);
    for (let n = 1; n < nbar; n++) num *= 1 - (m * m) / s2 / (A * A + (n - 0.5) ** 2);
    let den = 2;
    for (let n = 1; n < nbar; n++) if (n !== m) den *= 1 - (m * m) / (n * n);
    Fm.push(num / den);
  }
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 1;
    for (let m = 1; m < nbar; m++) s += 2 * Fm[m - 1] * Math.cos((TWO_PI * m * (i - N / 2 + 0.5)) / N);
    w[i] = s;
  }
  return normMax(w);
}

/** Classical window tapers: 'hamming', 'hann', 'blackman', 'triangular', 'cosine'. */
export function windowWeights(kind, N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const x = N > 1 ? i / (N - 1) : 0.5;
    switch (kind) {
      case 'hamming': w[i] = 0.54 - 0.46 * Math.cos(TWO_PI * x); break;
      case 'hann': w[i] = 0.5 - 0.5 * Math.cos(TWO_PI * x); break;
      case 'blackman': w[i] = 0.42 - 0.5 * Math.cos(TWO_PI * x) + 0.08 * Math.cos(2 * TWO_PI * x); break;
      case 'triangular': w[i] = 1 - Math.abs(2 * x - 1); break;
      case 'cosine': w[i] = Math.sin(Math.PI * x); break;
      default: w[i] = 1;
    }
  }
  // Hann / Blackman end elements are zero: keep a tiny floor so the array still has N "elements"
  return normMax(w);
}

export const TAPERS = [
  { id: 'uniform', label: 'uniform' },
  { id: 'binomial', label: 'binomial' },
  { id: 'chebyshev', label: 'Dolph-Chebyshev' },
  { id: 'taylor', label: 'Taylor (n-bar 4)' },
  { id: 'hamming', label: 'Hamming' },
  { id: 'hann', label: 'Hann' },
  { id: 'triangular', label: 'triangular' },
];

/** Weights by taper id. */
export function weightsFor(kind, N, sllDb = 30) {
  switch (kind) {
    case 'binomial': return binomialWeights(N);
    case 'chebyshev': return chebyshevWeights(N, sllDb);
    case 'taylor': return taylorWeights(N, sllDb, 4);
    case 'hamming': case 'hann': case 'blackman': case 'triangular': case 'cosine': return windowWeights(kind, N);
    default: return uniformWeights(N);
  }
}

// ---------------------------------------------------------------------------------------------
// Planar arrays (xy plane, separable)

/** Progressive phases (bx, by) that steer a planar array to (theta0 from +z, phi0). */
export function planarSteering(dx, dy, theta0, phi0) {
  return {
    bx: -TWO_PI * dx * Math.sin(theta0) * Math.cos(phi0),
    by: -TWO_PI * dy * Math.sin(theta0) * Math.sin(phi0),
  };
}

/** |AF| of the separable planar array at (theta from +z, phi). */
export function planarAF(wx, wy, dx, dy, bx, by, theta, phi) {
  const s = Math.sin(theta);
  return afMag(wx, TWO_PI * dx * s * Math.cos(phi) + bx) * afMag(wy, TWO_PI * dy * s * Math.sin(phi) + by);
}

/**
 * Samples the planar pattern on a (nTheta + 1) x (nPhi + 1) grid, theta in [0, pi], phi in [0, 2 pi].
 * Returns { nTheta, nPhi, amp (Float32Array, normalised to max 1), max, directivity }.
 */
export function samplePlanar({ wx, wy, dx, dy, bx, by, elem = 'iso', nTheta = 60, nPhi = 120 }) {
  const amp = new Float32Array((nTheta + 1) * (nPhi + 1));
  let max = 0;
  for (let i = 0; i <= nTheta; i++) {
    const th = (Math.PI * i) / nTheta;
    for (let j = 0; j <= nPhi; j++) {
      const ph = (TWO_PI * j) / nPhi;
      const a = planarAF(wx, wy, dx, dy, bx, by, th, ph) * planarElement(elem, th, ph);
      amp[i * (nPhi + 1) + j] = a;
      if (a > max) max = a;
    }
  }
  if (max > 0) for (let k = 0; k < amp.length; k++) amp[k] /= max;
  // D = 4 pi / integral(F^2 dOmega)
  let s = 0;
  const dth = Math.PI / nTheta, dph = TWO_PI / nPhi;
  for (let i = 0; i <= nTheta; i++) {
    const wt = (i === 0 || i === nTheta ? 0.5 : 1) * Math.sin((Math.PI * i) / nTheta);
    for (let j = 0; j < nPhi; j++) s += wt * amp[i * (nPhi + 1) + j] ** 2 * dth * dph;
  }
  const directivity = s > 0 ? (4 * Math.PI) / s : Infinity;
  return { nTheta, nPhi, amp, max, directivity };
}

/**
 * Builds a 3D pattern surface mesh from planar samples: radius is the dB level mapped linearly from
 * [floorDb, 0] to [0, 1]. Returns { positions, indices, values } (values: amplitude 0..1 per vertex)
 * for lib/render3d.js prepareMesh.
 */
export function patternMesh(samples, floorDb = -40) {
  const { nTheta, nPhi, amp } = samples;
  const nv = (nTheta + 1) * (nPhi + 1);
  const positions = new Float32Array(nv * 3), values = new Float32Array(nv);
  for (let i = 0; i <= nTheta; i++) {
    const th = (Math.PI * i) / nTheta;
    for (let j = 0; j <= nPhi; j++) {
      const ph = (TWO_PI * j) / nPhi, k = i * (nPhi + 1) + j;
      const a = amp[k];
      const r = Math.max(0, 1 - toDb(a, floorDb) / floorDb);
      positions[k * 3] = r * Math.sin(th) * Math.cos(ph);
      positions[k * 3 + 1] = r * Math.sin(th) * Math.sin(ph);
      positions[k * 3 + 2] = r * Math.cos(th);
      values[k] = a;
    }
  }
  const indices = new Uint32Array(nTheta * nPhi * 6);
  let o = 0;
  for (let i = 0; i < nTheta; i++) {
    for (let j = 0; j < nPhi; j++) {
      const a = i * (nPhi + 1) + j, b = a + 1, c = a + nPhi + 1, d = c + 1;
      indices[o++] = a; indices[o++] = c; indices[o++] = b;
      indices[o++] = b; indices[o++] = c; indices[o++] = d;
    }
  }
  return { positions, indices, values };
}
