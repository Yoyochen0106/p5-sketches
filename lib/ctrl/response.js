/**
 * Time response of linear systems (TF or state space) and the classical time-domain specifications.
 *
 * All simulations use exact discretisation of a controllable-canonical realisation (see ss.js): zero-order hold on
 * the input (exact for steps; use hold:'foh' for ramps/sines) so the sampled output equals the continuous response.
 * A transport delay T is applied exactly to the forced response (output shifted by T, linear interpolation).
 * Results are {t, y, u, x} with Float64Array t/y/u (x = array of state vectors, undelayed realisation).
 *
 * Specifications: stepInfo() measures them on a sampled response (linear / parabolic interpolation);
 * secondOrderFormulas() gives the textbook closed-form values for cross-checks.
 */
import { tf2ss, simulate, isSs } from './ss.js';
import { charPoly } from './_mat.js';
import { polyRoots, dcGain, limitAtZero, systemType, toTf, isTf } from './tf.js';

/** Realisation of a TF object or pass through a state-space object. */
export function toStateSpace(sys) {
  if (isSs(sys)) return sys;
  return tf2ss(toTf(sys));
}

/**
 * Pick a sensible simulation horizon from the poles: ~5 time constants of the slowest stable pole, at least a few
 * oscillation periods, growth e-folds for unstable systems, plus any delay. Returns seconds.
 */
export function autoTimeSpan(sys) {
  const G = isTf(sys) ? sys : null;
  let poles;
  if (G) poles = polyRoots(G.den);
  else poles = toStateSpace(sys).n ? eigOf(sys) : [];
  const delay = (sys.delay || 0);
  if (!poles.length) return Math.max(1, 5 * delay);
  let tmax = 0;
  for (const p of poles) {
    const re = p[0], w = Math.abs(p[1]);
    const mag = Math.hypot(re, w);
    if (mag < 1e-9) continue;
    if (re < -1e-9 * Math.max(1, mag)) tmax = Math.max(tmax, 5 / -re, w > 1e-9 ? 4 * (2 * Math.PI / w) : 0);
    else if (re > 1e-9) tmax = Math.max(tmax, 8 / re);
    else tmax = Math.max(tmax, w > 1e-9 ? 8 * (2 * Math.PI / w) : 10);
  }
  if (tmax === 0) tmax = 10;
  return tmax + 2 * delay;
}
function eigOf(sys) { return polyRoots(charPoly(sys.A)); }

function grid(sys, opts) {
  if (opts.dt && opts.n) return { tEnd: opts.dt * opts.n, dt: opts.dt, N: opts.n };
  const tEnd = opts.tEnd || autoTimeSpan(sys);
  const dt = opts.dt || tEnd / (opts.n || 1000);
  return { tEnd, dt, N: Math.max(1, Math.round(tEnd / dt)) };
}

/** Linear interpolation of uniformly sampled y at time tq (0 before the first sample, last value after). */
function sampleAt(t, y, tq) {
  if (tq <= 0) return tq < 0 ? 0 : y[0];
  const dt = t[1] - t[0];
  const f = tq / dt, i = Math.floor(f);
  if (i >= y.length - 1) return y[y.length - 1];
  const a = f - i;
  return y[i] * (1 - a) + y[i + 1] * a;
}

/**
 * General linear simulation. `input` may be a function u(t), an array of samples (one per grid point), or one of the
 * named signals via the helper functions below. Initial state x0 refers to the realisation returned by toStateSpace()
 * (for a TF: controllable canonical, x = [y, y', ..] when D = 0). With x0 and a delay, the free response is not delayed.
 * @param {object} sys TF {num, den, delay} or ss {A,B,C,D,delay}
 * @param {{tEnd?:number, dt?:number, n?:number, x0?:number[], hold?:'zoh'|'foh', impulse?:boolean}} opts
 */
export function lsim(sys, input, opts = {}) {
  const S = toStateSpace(sys);
  const delay = sys.delay || S.delay || 0;
  const { tEnd, dt, N } = grid(sys, opts);
  const fn = typeof input === 'function' ? input : (_, k) => input[k];
  const run = (x0, inp) => simulate(S, inp, { dt, n: N, x0, hold: opts.hold || 'zoh' });
  const forced = run(opts.impulse ? S.B.map((r) => r[0]) : new Array(S.n).fill(0), opts.impulse ? () => 0 : fn);
  let y = forced.y;
  if (delay > 0) {
    const ys = new Float64Array(N + 1);
    for (let k = 0; k <= N; k++) ys[k] = sampleAt(forced.t, forced.y, forced.t[k] - delay);
    // an impulse at t=0 shifted to t=delay: sample at t-delay >= 0 only (sampleAt returns 0 for negative)
    y = ys;
  }
  let uOut = forced.u;
  if (opts.impulse) uOut = new Float64Array(N + 1);
  let x = forced.x;
  if (opts.x0 && opts.x0.some((v) => v !== 0)) {
    const free = run(opts.x0, () => 0);
    y = Float64Array.from(y, (v, k) => v + free.y[k]);
    x = free.x.map((xs, k) => xs.map((v, i) => v + (forced.x[k][i] || 0)));
  }
  return { t: forced.t, y, u: uOut, x, dt, tEnd, delay };
}

/** Step response (amplitude `amp`, default 1) of a TF or state-space system. */
export function step(sys, opts = {}) {
  const a = opts.amp ?? 1;
  const r = lsim(sys, () => a, opts);
  r.u = Float64Array.from(r.t, () => a); // input as applied at the plant input (before the transport delay)
  return r;
}
/** Unit impulse response h(t) = C e^{At} B (the direct term D delta(t) is not shown). */
export function impulse(sys, opts = {}) {
  return lsim(sys, () => 0, { ...opts, impulse: true });
}
/** Ramp response (slope `slope`, default 1). Uses first-order hold for exactness. */
export function ramp(sys, opts = {}) {
  const k = opts.slope ?? 1;
  return lsim(sys, (t) => k * t, { hold: 'foh', ...opts });
}
/** Parabolic input 0.5 a t^2. */
export function parabola(sys, opts = {}) {
  const a = opts.accel ?? 1;
  return lsim(sys, (t) => 0.5 * a * t * t, { hold: 'foh', ...opts });
}
/** Sinusoid amp*sin(w t + phase) applied from t = 0. */
export function sine(sys, w, opts = {}) {
  const amp = opts.amp ?? 1, ph = opts.phase ?? 0;
  const tEnd = opts.tEnd || Math.max(autoTimeSpan(sys), (8 * 2 * Math.PI) / w);
  return lsim(sys, (t) => amp * Math.sin(w * t + ph), { hold: 'foh', ...opts, tEnd });
}
/**
 * Response to arbitrary samples `u[k]` taken at t_k = k*dt (zero-order hold between samples).
 */
export function sampledInput(sys, u, dt, opts = {}) {
  return lsim(sys, Array.from(u), { ...opts, dt, tEnd: (u.length - 1) * dt, n: u.length - 1 });
}

// ---------------------------------------------------------------- steady-state error constants

/**
 * Static error constants of a unity-feedback LOOP transfer function L(s):
 * Kp = lim L, Kv = lim s L, Ka = lim s^2 L and the resulting steady-state errors
 * (step 1/(1+Kp), ramp 1/Kv, parabola 1/Ka; 0 or Infinity where the limits say so).
 */
export function errorConstants(L) {
  const Kp = limitAtZero(L, 0), Kv = limitAtZero(L, 1), Ka = limitAtZero(L, 2);
  const inv = (k) => (k === 0 ? Infinity : Math.abs(k) === Infinity ? 0 : 1 / k);
  return {
    type: systemType(L), Kp, Kv, Ka,
    essStep: Math.abs(Kp) === Infinity ? 0 : 1 / (1 + Kp),
    essRamp: inv(Kv), essParabola: inv(Ka),
  };
}

// ---------------------------------------------------------------- step specifications

/**
 * Time-domain specifications of a sampled step response.
 * @param {ArrayLike<number>} t uniform (or monotone) times
 * @param {ArrayLike<number>} y response
 * @param {{final?:number, y0?:number}} opts final = steady-state value (default: last sample), y0 = initial value
 * @returns {{yss, y0, riseTime, t10, t90, delayTime, peakTime, peakValue, overshootPct, undershootPct,
 *            settling2, settling5, settled}} NaN where a quantity does not exist (e.g. never reaches 90%).
 */
export function stepInfo(t, y, opts = {}) {
  const N = y.length - 1;
  const y0 = opts.y0 ?? y[0];
  const yss = opts.final ?? y[N];
  const A = yss - y0;
  const nan = { yss, y0, riseTime: NaN, t10: NaN, t90: NaN, delayTime: NaN, peakTime: NaN, peakValue: NaN, overshootPct: NaN,
    undershootPct: NaN, settling2: NaN, settling5: NaN, settled: false };
  if (!(Math.abs(A) > 1e-12) || !Number.isFinite(A)) return nan;
  const z = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) z[k] = (y[k] - y0) / A;
  const cross = (level) => {
    for (let k = 0; k < N; k++) {
      if (z[k] < level && z[k + 1] >= level) return t[k] + ((level - z[k]) / (z[k + 1] - z[k])) * (t[k + 1] - t[k]);
    }
    return NaN;
  };
  const lowF = opts.riseLow ?? 0.1, highF = opts.riseHigh ?? 0.9;
  const t10 = cross(lowF), t90 = cross(highF);
  // peak
  let kp = 0;
  for (let k = 1; k <= N; k++) if (z[k] > z[kp]) kp = k;
  let tp = t[kp], zp = z[kp];
  if (kp > 0 && kp < N) { // parabolic refinement
    const a = z[kp - 1], b = z[kp], c = z[kp + 1];
    const den = a - 2 * b + c;
    if (den < 0) {
      const d = 0.5 * (a - c) / den;
      tp = t[kp] + d * (t[kp + 1] - t[kp]);
      zp = b - 0.25 * (a - c) * d;
    }
  }
  const os = Math.max(0, zp - 1) * 100;
  let zmin = 0;
  for (let k = 0; k <= N; k++) if (z[k] < zmin) zmin = z[k];
  const settle = (tol) => {
    for (let k = N; k >= 0; k--) {
      if (Math.abs(z[k] - 1) > tol) {
        if (k === N) return NaN;
        const e0 = Math.abs(z[k] - 1) - tol, e1 = tol - Math.abs(z[k + 1] - 1);
        const f = e0 / (e0 + e1);
        return t[k] + f * (t[k + 1] - t[k]);
      }
    }
    return t[0];
  };
  const s2 = settle(0.02), s5 = settle(0.05);
  return {
    yss, y0,
    riseTime: t90 - t10, t10, t90, delayTime: cross(0.5),
    peakTime: os > 1e-6 ? tp : NaN, peakValue: y0 + zp * A, overshootPct: os, undershootPct: -zmin * 100,
    settling2: s2, settling5: s5, settled: Number.isFinite(s2),
  };
}

/** Simulate the step response of `sys` and measure it (final value = DC gain when finite and the system is stable). */
export function stepSpecs(sys, opts = {}) {
  const r = step(sys, opts);
  const G = isTf(sys) ? sys : null;
  let final;
  if (G) { const g = dcGain(G); if (Number.isFinite(g) && opts.useDcGain !== false) final = g * (opts.amp ?? 1); }
  return { ...stepInfo(r.t, r.y, { final: opts.final ?? final }), response: r };
}

// ---------------------------------------------------------------- second order closed forms

/** Closed-form unit step response of wn^2/(s^2 + 2 zeta wn s + wn^2) at time t (any zeta > 0, wn > 0). */
export function secondOrderStep(zeta, wn, t) {
  if (t <= 0) return 0;
  if (zeta < 1 - 1e-9) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const phi = Math.acos(zeta);
    return 1 - (Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t + phi);
  }
  if (zeta > 1 + 1e-9) {
    const r = wn * Math.sqrt(zeta * zeta - 1);
    const s1 = -zeta * wn + r, s2 = -zeta * wn - r;
    return 1 + (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s1 - s2);
  }
  return 1 - Math.exp(-wn * t) * (1 + wn * t);
}

/** zeta from a percent overshoot: zeta = -ln(OS) / sqrt(pi^2 + ln^2(OS)). */
export function zetaFromOvershoot(pct) {
  if (pct <= 0) return 1;
  const l = Math.log(pct / 100);
  return -l / Math.sqrt(Math.PI * Math.PI + l * l);
}

/**
 * Textbook second-order specifications for K=1 and 0 < zeta:
 * OS% = 100 exp(-pi zeta / sqrt(1-zeta^2)), Tp = pi / wd, Ts(2%) ~ 4/(zeta wn), Ts(5%) ~ 3/(zeta wn); rise time 10-90 is
 * solved from the exact step response (and also given by the rule of thumb (2.16 zeta + 0.6)/wn for 0.3 < zeta < 0.8).
 * settling2Exact/settling5Exact use the envelope exp(-zeta wn t)/sqrt(1-zeta^2) = tol.
 */
export function secondOrderFormulas(zeta, wn) {
  const under = zeta < 1;
  const wd = under ? wn * Math.sqrt(1 - zeta * zeta) : 0;
  const overshootPct = under ? 100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) : 0;
  const peakTime = under ? Math.PI / wd : Infinity;
  const f = (t) => secondOrderStep(zeta, wn, t);
  const tHi = under ? peakTime : 60 / (wn * Math.max(1e-6, zeta - Math.sqrt(Math.max(0, zeta * zeta - 1))));
  const bis = (lvl) => {
    let lo = 0, hi = tHi;
    for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (f(mid) < lvl) lo = mid; else hi = mid; }
    return 0.5 * (lo + hi);
  };
  const t10 = bis(0.1), t90 = bis(0.9);
  const env = (tol) => (under ? -Math.log(tol * Math.sqrt(1 - zeta * zeta)) / (zeta * wn) : NaN);
  return {
    zeta, wn, wd, sigma: zeta * wn, overshootPct, peakTime,
    riseTime: t90 - t10, riseTimeRule: (2.16 * zeta + 0.6) / wn,
    settling2: 4 / (zeta * wn), settling5: 3 / (zeta * wn),
    settling2Exact: env(0.02), settling5Exact: env(0.05),
    phaseAngleDeg: (Math.acos(Math.min(1, zeta)) * 180) / Math.PI,
  };
}

/** Pole {re, im} (complex pair member) -> {zeta, wn, sigma, wd}; zeta = -Re/|p|. */
export function poleSpecs(p) {
  const wn = Math.hypot(p[0], p[1]);
  return { zeta: wn ? -p[0] / wn : NaN, wn, sigma: -p[0], wd: Math.abs(p[1]) };
}
