// Transmission-line theory, the Smith chart and matching networks. Pure functions, no p5 / DOM.
//
// Conventions
//   * Complex numbers are [re, im] arrays (see lib/complex.js).
//   * d is the distance from the LOAD toward the generator (metres or wavelengths, as documented).
//   * Voltage / current phasors on the line: V(d) = V+ (e^{g d} + GammaL e^{-g d}),
//                                             I(d) = V+/Z0 (e^{g d} - GammaL e^{-g d}),  g = alpha + j beta.
//   * The Smith chart is the Moebius map w = (z - 1)/(z + 1) of the normalised impedance plane; we
//     build it with lib/conformal.js (applyMoebius), so the chart is literally the conformal-map unit.
import * as C from '../complex.js';
import { applyMoebius } from '../conformal.js';

export const C0 = 299792458; // speed of light, m/s
const TWO_PI = 2 * Math.PI;
const EPS = 1e-12;
const isFin = (z) => Number.isFinite(z[0]) && Number.isFinite(z[1]);

/** Moebius coefficients [a, b, c, d] of the Smith map z -> (z - 1)/(z + 1). */
export const SMITH_MAP = [[1, 0], [-1, 0], [1, 0], [1, 0]];
/** Inverse map Gamma -> (1 + Gamma)/(1 - Gamma). */
export const SMITH_INVERSE = [[1, 0], [1, 0], [-1, 0], [1, 0]];

/** Normalised impedance z -> reflection coefficient Gamma (Infinity maps to 1). */
export function zToGamma(z) {
  if (!isFin(z)) return [1, 0];
  return applyMoebius(SMITH_MAP, z);
}
/** Reflection coefficient -> normalised impedance (Gamma = 1 gives [Infinity, Infinity]). */
export function gammaToZ(g) {
  return applyMoebius(SMITH_INVERSE, g);
}
/** Normalised admittance y = 1/z as a function of Gamma: Gamma -> -Gamma (a half turn on the chart). */
export function gammaToY(g) { return gammaToZ(C.neg(g)); }

/** Gamma_L = (ZL - Z0)/(ZL + Z0) for a real Z0 and complex ZL ([Infinity, 0] = open circuit). */
export function loadGamma(zl, z0) {
  if (!isFin(zl)) return [1, 0];
  return zToGamma([zl[0] / z0, zl[1] / z0]);
}
/** Load impedance (ohms) from Gamma. */
export function gammaToLoad(g, z0) {
  const z = gammaToZ(g);
  return isFin(z) ? [z[0] * z0, z[1] * z0] : [Infinity, Infinity];
}

/**
 * Complex propagation constant of a line.
 * @param {{f:number, vf?:number, alpha?:number}} o  frequency (Hz), velocity factor, attenuation (Np/m)
 * @returns {{gamma:number[], alpha:number, beta:number, wavelength:number, velocity:number}}
 */
export function propagation({ f, vf = 1, alpha = 0 }) {
  const velocity = C0 * vf;
  const beta = (TWO_PI * f) / velocity;
  return { gamma: [alpha, beta], alpha, beta, wavelength: velocity / f, velocity };
}

/** Gamma(d) = GammaL exp(-2 gamma d), gamma = [alpha, beta]. */
export function gammaAt(gammaL, gamma, d) {
  return C.mul(gammaL, C.exp([-2 * gamma[0] * d, -2 * gamma[1] * d]));
}

/** Input impedance (ohms) a distance d from the load: Z0 (ZL + Z0 tanh gd)/(Z0 + ZL tanh gd). */
export function zin(zl, z0, gamma, d) {
  // cosh / sinh form: no singularity at quarter-wave lengths (unlike tanh)
  const a = [gamma[0] * d, gamma[1] * d];
  const ch = C.cosh(a), sh = C.sinh(a);
  let r;
  if (!isFin(zl)) r = C.scale(C.div(ch, sh), z0); // open circuit: Z0 coth(gd)
  else r = C.scale(C.div(C.add(C.mul(zl, ch), C.scale(sh, z0)), C.add(C.scale(ch, z0), C.mul(zl, sh))), z0);
  return isFin(r) ? r : [Infinity, Infinity];
}

/** Lossless shortcut: Zin at electrical length theta (radians) from the load. */
export function zinLossless(zl, z0, theta) { return zin(zl, z0, [0, 1], theta); }

/** VSWR = (1 + |G|)/(1 - |G|); Infinity for |G| >= 1. */
export function vswr(gMag) { return gMag >= 1 - 1e-15 ? Infinity : (1 + gMag) / (1 - gMag); }
/** |Gamma| from a VSWR. */
export function gammaFromVswr(s) { return Number.isFinite(s) ? (s - 1) / (s + 1) : 1; }
/** Return loss in dB (positive; Infinity for a perfect match). */
export function returnLossDb(gMag) { return gMag <= 0 ? Infinity : -20 * Math.log10(gMag); }
/** Mismatch loss in dB: -10 log10(1 - |G|^2). */
export function mismatchLossDb(gMag) { return gMag >= 1 ? Infinity : -10 * Math.log10(1 - gMag * gMag); }

/**
 * Voltage and current phasors at distance d from the load (normalised to V+ = 1 at the load end).
 * i is in units of 1/Z0.
 */
export function lineWaves(gammaL, gamma, d) {
  const fwd = C.exp([gamma[0] * d, gamma[1] * d]);
  const bwd = C.mul(gammaL, C.exp([-gamma[0] * d, -gamma[1] * d]));
  const v = C.add(fwd, bwd), i = C.sub(fwd, bwd);
  return { v, i, vMag: C.abs(v), iMag: C.abs(i), fwd, bwd };
}

/**
 * Positions (in wavelengths from the load, lossless line) of the first voltage maximum and minimum:
 * dMax = phi/(4 pi) (mod 1/2) for Gamma_L = |G| e^{j phi}, dMin = dMax + 1/4 (mod 1/2).
 */
export function standingWaveNodes(gammaL) {
  const phi = Math.atan2(gammaL[1], gammaL[0]);
  const mod = (x) => ((x % 0.5) + 0.5) % 0.5;
  const dMax = mod(phi / (4 * Math.PI));
  return { dMax, dMin: mod(dMax + 0.25), period: 0.5, gMag: C.abs(gammaL) };
}

/**
 * Real instantaneous waves at time t (s): incident, reflected and total voltage at distance d (m)
 * from the load. incident = Re{e^{g d} e^{j w t}} (travels toward the load), reflected likewise.
 */
export function instantaneousWaves({ gammaL, gamma, omega, t, d }) {
  const ph = omega * t;
  const inc = Math.exp(gamma[0] * d) * Math.cos(ph + gamma[1] * d);
  const a = ph - gamma[1] * d;
  const ref = Math.exp(-gamma[0] * d) * (gammaL[0] * Math.cos(a) - gammaL[1] * Math.sin(a));
  return { inc, ref, total: inc + ref };
}

// ---------------------------------------------------------------------------------------------
// Smith chart geometry

/** Circle of constant normalised resistance r in the Gamma plane. */
export function rCircle(r) { return { c: [r / (1 + r), 0], r: 1 / (1 + r) }; }
/** Circle of constant normalised reactance x (x != 0): centre (1, 1/x), radius 1/|x|. */
export function xCircle(x) { return { c: [1, 1 / x], r: 1 / Math.abs(x) }; }
/** Constant-|Gamma| circle for a VSWR s. */
export function swrCircle(s) { return { c: [0, 0], r: gammaFromVswr(s) }; }

/** Rotate Gamma toward the generator by dLambda wavelengths (negative = toward the load); loss-free. */
export function rotateGamma(g, dLambda) {
  return C.mul(g, C.fromPolar(1, -2 * TWO_PI * dLambda));
}
/** "Wavelengths toward generator" scale reading (0..0.5) for a Gamma angle phi (0 at phi = pi). */
export function wtgReading(phi) {
  const x = (Math.PI - phi) / (4 * Math.PI);
  return ((x % 0.5) + 0.5) % 0.5;
}
/** "Wavelengths toward load" scale reading. */
export function wtlReading(phi) {
  const x = (phi - Math.PI) / (4 * Math.PI);
  return ((x % 0.5) + 0.5) % 0.5;
}

// ---------------------------------------------------------------------------------------------
// Matching

/** Quarter-wave transformer characteristic impedance for a real load: sqrt(Z0 RL). */
export function quarterWaveZ(z0, rl) { return Math.sqrt(z0 * rl); }

const mod05 = (x) => ((x % 0.5) + 0.5) % 0.5;

/**
 * Quarter-wave matching of a COMPLEX load: slide to a voltage maximum ('max', Zin = Z0 VSWR) or minimum
 * ('min', Zin = Z0/VSWR), where the line impedance is real, and insert a quarter-wave section of
 * impedance zt = sqrt(Z0 Rin). Returns { dLambda, rin, zt } or null for |Gamma| >= 1.
 */
export function quarterWaveMatch(zl, z0, at = 'max') {
  const g = loadGamma(zl, z0);
  const s = vswr(C.abs(g));
  if (!Number.isFinite(s)) return null;
  const nodes = standingWaveNodes(g);
  const rin = at === 'min' ? z0 / s : z0 * s;
  return { dLambda: at === 'min' ? nodes.dMin : nodes.dMax, rin, zt: Math.sqrt(z0 * rin) };
}
/** |Gamma| of load + line (dLambda) + quarter-wave section (zt), frequency ratio fr (lengths scale with fr). */
export function quarterWaveMatchGamma(zl, z0, sol, fr = 1) {
  const z1 = zinLossless(zl, z0, TWO_PI * sol.dLambda * fr);
  const z2 = isFin(z1) ? zinLossless(z1, sol.zt, (Math.PI / 2) * fr) : z1;
  return isFin(z2) ? C.abs(loadGamma(z2, z0)) : 1;
}

/**
 * Single shunt-stub matching of a (lossless) load; zl in ohms.
 * Returns the two solutions {dLambda, lLambda, stubB, yAtStub} sorted by d: d is the distance from
 * the load to the stub in wavelengths, l the stub length in wavelengths (short or open), stubB the
 * normalised susceptance the stub provides. Exact: y(d) = 1 + jb and the stub supplies -b.
 */
export function singleStub(zl, z0, type = 'short') {
  const z = C.scale(zl, 1 / z0);
  const y = C.div([1, 0], z);
  if (!isFin(y)) return [];
  const g = y[0], b = y[1];
  // Re y(d) = 1 with t = tan(beta d):  (b^2 + g^2 - g) t^2 - 2 b t + (1 - g) = 0
  const A = b * b + g * g - g, B = -2 * b, Cc = 1 - g;
  const ts = [];
  if (Math.abs(A) < 1e-12) ts.push(Math.abs(B) > 1e-12 ? -Cc / B : 0);
  else {
    const disc = B * B - 4 * A * Cc;
    if (disc < -1e-12) return [];
    const s = Math.sqrt(Math.max(0, disc));
    ts.push((-B + s) / (2 * A), (-B - s) / (2 * A));
  }
  const out = [];
  for (const t of ts) {
    const dL = mod05(Math.atan(t) / TWO_PI);
    const yd = C.div([1, 0], zinLossless(z, 1, TWO_PI * dL));
    if (!isFin(yd)) continue;
    const need = -yd[1];
    // short stub: b = -cot(theta); open stub: b = tan(theta)
    const lL = type === 'open' ? mod05(Math.atan(need) / TWO_PI) : mod05(Math.atan2(1, -need) / TWO_PI);
    out.push({ dLambda: dL, lLambda: lL, stubB: need, yAtStub: yd });
  }
  out.sort((p, q) => p.dLambda - q.dLambda);
  return out;
}

/** Normalised susceptance of a shunt stub of length l (wavelengths), type 'short' | 'open'. */
export function stubSusceptance(lLambda, type) {
  const th = TWO_PI * lLambda;
  const v = type === 'open' ? Math.tan(th) : -1 / Math.tan(th);
  return Number.isFinite(v) ? Math.max(-1e9, Math.min(1e9, v)) : (v > 0 ? 1e9 : -1e9);
}

/**
 * Normalised input admittance of load + line + shunt stub for a frequency ratio fr = f/f0
 * (electrical lengths scale with fr; the load impedance is held fixed).
 */
export function singleStubYin(zl, z0, sol, type, fr = 1) {
  const z = C.scale(zl, 1 / z0);
  const yline = C.div([1, 0], zinLossless(z, 1, TWO_PI * sol.dLambda * fr));
  return C.add(yline, [0, stubSusceptance(sol.lLambda * fr, type)]);
}
/** |Gamma| at the input of the single-stub network at frequency ratio fr. */
export function singleStubGamma(zl, z0, sol, type, fr = 1) {
  const y = singleStubYin(zl, z0, sol, type, fr);
  return isFin(y) ? C.abs(zToGamma(C.div([1, 0], y))) : 1;
}
/** |Gamma| of a quarter-wave section (impedance zt, 90 degrees at fr = 1) in front of zl. */
export function quarterWaveGamma(zl, z0, zt, fr = 1) {
  const zi = zinLossless(zl, zt, (Math.PI / 2) * fr);
  return isFin(zi) ? C.abs(loadGamma(zi, z0)) : 1;
}

/**
 * L-section matching of a load to a real Z0. Returns up to two solutions { topology, X, B }: X is the
 * series reactance (ohm), B the shunt susceptance (S).
 *   'shunt-load'  : shunt B across the load, then series X toward the source (RL >= Z0)
 *   'series-load' : series X next to the load, then shunt B toward the source (RL < Z0)
 */
export function lMatch(zl, z0) {
  const [R, X] = zl;
  if (!(R > 0) || !Number.isFinite(X)) return [];
  const sols = [];
  if (R >= z0) {
    const disc = (R / z0) * (R * R + X * X - z0 * R);
    if (disc < 0) return [];
    const s = Math.sqrt(disc), den = R * R + X * X;
    for (const sg of [1, -1]) {
      const Bv = (X + sg * s) / den;
      const Xs = Math.abs(Bv) > EPS ? 1 / Bv + (X * z0) / R - z0 / (Bv * R) : 0;
      sols.push({ topology: 'shunt-load', X: Xs, B: Bv });
    }
  } else {
    const s = Math.sqrt(R * (z0 - R));
    for (const sg of [1, -1]) {
      sols.push({ topology: 'series-load', X: sg * s - X, B: (sg * Math.sqrt((z0 - R) / R)) / z0 });
    }
  }
  return sols;
}
/** Input impedance of load + L-section; element values are those at f0, scaled to fr = f/f0. */
export function lMatchZin(zl, sol, fr = 1) {
  const Xf = sol.X >= 0 ? sol.X * fr : sol.X / fr; // inductor grows with f, capacitor shrinks
  const Bf = sol.B >= 0 ? sol.B * fr : sol.B / fr; // positive B is a capacitor
  if (sol.topology === 'shunt-load') {
    const y = C.add(C.div([1, 0], zl), [0, Bf]);
    return C.add(C.div([1, 0], y), [0, Xf]);
  }
  const z = C.add(zl, [0, Xf]);
  return C.div([1, 0], C.add(C.div([1, 0], z), [0, Bf]));
}
/** |Gamma| of the L-section network versus frequency ratio. */
export function lMatchGamma(zl, z0, sol, fr = 1) {
  const zi = lMatchZin(zl, sol, fr);
  return isFin(zi) ? C.abs(loadGamma(zi, z0)) : 1;
}
/** Lumped element for a series reactance (kind 'X', ohm) or shunt susceptance ('B', S) at f: {type, value}. */
export function elementFor(kind, v, f) {
  const w = TWO_PI * f;
  if (kind === 'X') return v >= 0 ? { type: 'L', value: v / w } : { type: 'C', value: -1 / (w * v) };
  return v >= 0 ? { type: 'C', value: v / w } : { type: 'L', value: -1 / (w * v) };
}

/**
 * Contiguous band (frequency ratios around fr = 1) where the return loss is at least rlDb.
 * gammaFn(fr) -> |Gamma|. Returns { lo, hi, fractional } or null if fr = 1 itself fails.
 */
export function matchBandwidth(gammaFn, rlDb = 10, { span = 0.9, n = 900 } = {}) {
  const ok = (fr) => returnLossDb(gammaFn(fr)) >= rlDb;
  if (!ok(1)) return null;
  const step = span / n;
  let lo = 1, hi = 1;
  while (lo - step > 1 - span && ok(lo - step)) lo -= step;
  while (hi + step < 1 + span && ok(hi + step)) hi += step;
  return { lo, hi, fractional: hi - lo };
}

// ---------------------------------------------------------------------------------------------
// Time domain: exact discrete-time (magic-step) lossless line with resistive source and load

const refl = (r, z0) => (Number.isFinite(r) ? (r - z0) / (r + z0) : 1);

/**
 * Lattice (bounce) diagram: voltage at the load and source ends after each arrival. Times are in
 * units of the one-way delay Td. steady is the DC limit Vs ZL/(ZL + Zs).
 */
export function bounceDiagram({ z0, zs, zl, vs = 1, nBounces = 8 }) {
  const gs = refl(zs, z0), gl = refl(zl, z0);
  const v1 = (vs * z0) / (z0 + zs);
  const events = [];
  let wave = v1, t = 1, vLoad = 0, vSrc = v1;
  for (let k = 0; k < nBounces; k++) {
    vLoad += wave * (1 + gl);
    events.push({ side: 'load', t, incident: wave, voltage: vLoad });
    wave *= gl; t += 1;
    vSrc += wave * (1 + gs);
    events.push({ side: 'src', t, incident: wave, voltage: vSrc });
    wave *= gs; t += 1;
  }
  const steady = Number.isFinite(zl) ? (vs * zl) / (zl + zs) : vs;
  return { gs, gl, v1, events, steady };
}

/**
 * Exact lossless-line simulator. The line has N cells, each crossed in one step dt = Td/N, so the
 * forward / backward voltage waves f, b simply shift one cell per step (no numerical dispersion).
 * Cell energy is (f^2 + b^2) dt / Z0; the bookkeeping makes
 *   E_source = E_line + E_load + E_Zs
 * hold to rounding error, which the sketch displays as the energy-conservation check.
 */
export class LineSim {
  constructor({ z0 = 50, zs = 50, zl = Infinity, N = 200, td = 1 } = {}) {
    this.z0 = z0; this.zs = zs; this.zl = zl; this.N = Math.max(2, Math.floor(N));
    this.td = td; this.dt = td / this.N;
    this.gs = refl(zs, z0); this.gl = refl(zl, z0);
    this.reset();
  }
  reset() {
    this.f = new Float64Array(this.N); this.b = new Float64Array(this.N);
    this.t = 0; this.steps = 0;
    this.eSource = 0; this.eLoad = 0; this.eZs = 0;
    this.vLoad = 0; this.vSrc = 0; this.iSrc = 0;
  }
  /** Advance one step with Thevenin source voltage vs. */
  step(vs) {
    const { f, b, N, z0, dt } = this;
    const fin = f[N - 1], bin = b[0];
    this.eLoad += ((fin * fin) - (this.gl * fin) ** 2) / z0 * dt;
    this.vLoad = fin * (1 + this.gl);
    for (let i = N - 1; i > 0; i--) f[i] = f[i - 1];
    for (let i = 0; i < N - 1; i++) b[i] = b[i + 1];
    b[N - 1] = this.gl * fin;
    const zs = Number.isFinite(this.zs) ? this.zs : 1e30;
    const fnew = this.gs * bin + (vs * z0) / (z0 + zs);
    f[0] = fnew;
    const v0 = fnew + bin, i0 = (fnew - bin) / z0;
    this.vSrc = v0; this.iSrc = i0;
    this.eSource += vs * i0 * dt;
    this.eZs += (vs - v0) * i0 * dt;
    this.t += dt; this.steps++;
  }
  /** Energy stored in the line. */
  lineEnergy() {
    let s = 0;
    for (let i = 0; i < this.N; i++) s += this.f[i] * this.f[i] + this.b[i] * this.b[i];
    return (s / this.z0) * this.dt;
  }
  /** Voltage at cell i (0 = source end) = f + b. */
  voltageAt(i) { return this.f[i] + this.b[i]; }
  /** Relative energy-conservation residual. */
  energyResidual() {
    const lhs = this.eSource, rhs = this.lineEnergy() + this.eLoad + this.eZs;
    return Math.abs(lhs - rhs) / Math.max(1e-30, Math.abs(lhs), Math.abs(rhs));
  }
}
