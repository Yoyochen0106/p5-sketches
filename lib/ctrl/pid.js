/**
 * PID control: controller transfer functions, a discrete-time controller with derivative filter, setpoint weighting,
 * actuator saturation and anti-windup, a sampled closed-loop simulator for ANY plant (TF, state space or nonlinear
 * f(x,u)), performance indices and classical tuning rules.
 *
 * Parameter object (parallel form):   C(s) = Kp + Ki/s + Kd s / (Tf s + 1)
 *   { Kp, Ki, Kd, Tf | N, b, c, umin, umax, antiwindup: 'none'|'clamp'|'backcalc', Kt }
 *   - Tf: derivative filter time constant; or N with Tf = Td/N (Td = Kd/Kp); N = Infinity / Tf = 0 -> unfiltered.
 *   - b: setpoint weight on the proportional term (u_P = Kp (b r - y)); c: weight on r in the derivative term (default 0:
 *        derivative acts on the measurement only, no kick).
 *   - Standard (ideal) form  Kp (1 + 1/(Ti s) + Td s)  converts with pidFromStandard / pidToStandard.
 *   - Kt: back-calculation gain (default Ki/Kp = 1/Ti).
 */
import { tf, polyMul, toTf, dcGain } from './tf.js';
import { zohMatrices, mVec } from './_mat.js';
import { toStateSpace, step as stepResponse, stepInfo } from './response.js';
import { imaginaryAxisCrossings } from './rootlocus.js';
import { margins } from './freq.js';

// ------------------------------------------------------------------ forms and transfer functions

/** Standard form (Kp, Ti, Td, N) -> parallel gains {Kp, Ki, Kd, N}. Ti = Infinity switches the integral off. */
export function pidFromStandard({ Kp, Ti = Infinity, Td = 0, N = Infinity, ...rest }) {
  return { Kp, Ki: Number.isFinite(Ti) && Ti > 0 ? Kp / Ti : 0, Kd: Kp * Td, N, ...rest };
}
/** Parallel gains -> standard form {Kp, Ti, Td}. */
export function pidToStandard({ Kp, Ki = 0, Kd = 0 }) {
  return { Kp, Ti: Ki ? Kp / Ki : Infinity, Td: Kp ? Kd / Kp : 0 };
}
/** Derivative filter time constant Tf of a parameter object (0 when unfiltered). */
export function derivativeFilter(p) {
  if (p.Tf != null) return p.Tf;
  if (p.N != null && Number.isFinite(p.N) && p.N > 0) return (p.Kp ? p.Kd / p.Kp : p.Kd) / p.N;
  return 0;
}
/** Series (interacting) form Kc (1 + 1/(Ti s)) (1 + Td s) -> ideal form {Kp, Ti, Td} (as produced by SIMC for PID). */
export function serialToIdeal({ Kc, Ti, Td }) {
  return { Kp: Kc * (1 + Td / Ti), Ti: Ti + Td, Td: (Ti * Td) / (Ti + Td) };
}

/** The controller as a TF: (Kp Tf + Kd) s^2 + (Kp + Ki Tf) s + Ki over s (Tf s + 1) (cancelling what is not used). */
export function pidTf(p) {
  const Kp = p.Kp || 0, Ki = p.Ki || 0, Kd = p.Kd || 0, Tf = derivativeFilter(p);
  let num, den;
  if (Tf > 0) { num = [Kp * Tf + Kd, Kp + Ki * Tf, Ki]; den = [Tf, 1, 0]; }
  else { num = [Kd, Kp, Ki]; den = [1, 0]; }
  if (Ki === 0) { num = num.slice(0, -1); den = den.slice(0, -1); } // cancel the common factor s
  return tf(num, den);
}

/** Open loop L = C * G (PID times plant; a delay in G is kept). */
export function pidOpenLoop(p, G) {
  const C = pidTf(p), P = toTf(G);
  return tf(polyMul(C.num, P.num), polyMul(C.den, P.den), P.delay);
}

// ------------------------------------------------------------------ discrete controller

/**
 * Stateful discrete PID. update(r, y) returns {u, uUnsat, P, I, D, saturated}; call reset() to clear.
 * Integral: forward Euler on Ki e Ts. Derivative: backward-difference first-order filter on (c r - y).
 * Anti-windup: 'none' (plain integrator), 'clamp' (conditional integration: freeze I while saturated and the error pushes
 * deeper into saturation) or 'backcalc' (I += Ts Kt (u_sat - u_unsat)).
 */
export function createPid(params, Ts) {
  const p = { b: 1, c: 0, antiwindup: 'none', umin: -Infinity, umax: Infinity, ...params };
  const Tf = derivativeFilter(p);
  const Kt = p.Kt ?? ((p.Kp ? (p.Ki || 0) / p.Kp : 1) || 1);
  const st = { I: 0, D: 0, dinPrev: 0, first: true, lastU: 0 };
  return {
    params: p, Ts,
    reset(I0 = 0) { st.I = I0; st.D = 0; st.first = true; st.dinPrev = 0; },
    get state() { return { ...st }; },
    update(r, y) {
      const e = r - y;
      const P = p.Kp * (p.b * r - y);
      const din = p.c * r - y;
      if (st.first) { st.dinPrev = din; st.first = false; }
      if (p.Kd) {
        if (Tf > 0) st.D = (Tf / (Tf + Ts)) * st.D + (p.Kd / (Tf + Ts)) * (din - st.dinPrev);
        else st.D = (p.Kd * (din - st.dinPrev)) / Ts;
      } else st.D = 0;
      st.dinPrev = din;
      const Ipre = st.I + (p.Ki || 0) * Ts * e;
      const uUnsat = P + Ipre + st.D;
      const u = Math.min(p.umax, Math.max(p.umin, uUnsat));
      const sat = u !== uUnsat;
      if (p.antiwindup === 'clamp') st.I = sat && e * (uUnsat - u) > 0 ? st.I : Ipre;
      else if (p.antiwindup === 'backcalc') st.I = Ipre + Ts * Kt * (u - uUnsat);
      else st.I = Ipre;
      return { u, uUnsat, P, I: st.I, D: st.D, saturated: sat };
    },
  };
}

/** Deterministic standard-normal generator (mulberry32 + Box-Muller). */
export function makeGaussian(seed = 1) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uni())) * Math.cos(2 * Math.PI * uni());
}

// ------------------------------------------------------------------ performance

/** IAE, ISE, ITAE, ITSE of an error signal e(t) (trapezoidal rule). */
export function performanceIndices(t, e) {
  let IAE = 0, ISE = 0, ITAE = 0, ITSE = 0;
  for (let k = 1; k < t.length; k++) {
    const dt = t[k] - t[k - 1];
    const a0 = Math.abs(e[k - 1]), a1 = Math.abs(e[k]);
    IAE += 0.5 * dt * (a0 + a1);
    ISE += 0.5 * dt * (a0 * a0 + a1 * a1);
    ITAE += 0.5 * dt * (t[k - 1] * a0 + t[k] * a1);
    ITSE += 0.5 * dt * (t[k - 1] * a0 * a0 + t[k] * a1 * a1);
  }
  return { IAE, ISE, ITAE, ITSE };
}

/** Total variation of a signal (sum |u[k]-u[k-1]|): a measure of actuator activity. */
export function totalVariation(u) {
  let s = 0;
  for (let k = 1; k < u.length; k++) s += Math.abs(u[k] - u[k - 1]);
  return s;
}

// ------------------------------------------------------------------ closed-loop simulation

const asFn = (v) => (typeof v === 'function' ? v : () => v ?? 0);

/**
 * Sampled closed loop: controller (PID params, or a function (r, y, k, t) -> u) around any plant, with measurement noise,
 * load disturbance (added to the plant input after saturation) and output disturbance.
 *
 * Plant: a TF {num,den,delay}, a state-space object, or a nonlinear model {f(x,u,t) -> dx/dt, h?(x,u) -> y, x0}.
 * Linear plants are discretised exactly (zero-order hold at Ts); the transport delay is round(delay/Ts) whole samples.
 * Nonlinear plants are integrated by RK4 with `substeps` per sample. The controller sees y + noise and acts at each
 * sample on the held plant output.
 * @param {{plant, controller, Ts:number, tEnd:number, r?:number|Function, dLoad?:number|Function, dOut?:number|Function,
 *          noise?:{sigma:number, seed?:number}, umin?:number, umax?:number, antiwindup?:string, x0?:number[], substeps?:number}} o
 * @returns {{t, r, y, ym, u, uUnsat, e, P, I, D, saturated, indices, ...}} Float64Arrays (saturated: Uint8Array)
 */
export function simulateLoop(o) {
  const Ts = o.Ts;
  const N = Math.max(1, Math.round(o.tEnd / Ts));
  const rf = asFn(o.r ?? 1), dl = asFn(o.dLoad), dof = asFn(o.dOut);
  const gauss = o.noise && o.noise.sigma > 0 ? makeGaussian(o.noise.seed ?? 1) : null;
  const sig = o.noise?.sigma ?? 0;
  const isCtrlFn = typeof o.controller === 'function';
  const cp = isCtrlFn ? null : { ...(o.controller || {}) };
  if (cp) for (const k of ['umin', 'umax', 'antiwindup']) if (o[k] !== undefined) cp[k] = o[k];
  const ctl = cp ? createPid(cp, Ts) : null;

  // plant model
  const plant = o.plant;
  let stepPlant, outPlant, state;
  const sub = o.substeps ?? 10;
  if (plant && typeof plant.f === 'function') {
    state = (plant.x0 || o.x0 || [0]).slice();
    const h = plant.h || ((x) => x[0]);
    let uLast = 0;
    outPlant = () => h(state, uLast);
    stepPlant = (u, t) => {
      uLast = u;
      const hs = Ts / sub;
      for (let s = 0; s < sub; s++) {
        const tt = t + s * hs;
        const k1 = plant.f(state, u, tt);
        const k2 = plant.f(state.map((v, i) => v + 0.5 * hs * k1[i]), u, tt + 0.5 * hs);
        const k3 = plant.f(state.map((v, i) => v + 0.5 * hs * k2[i]), u, tt + 0.5 * hs);
        const k4 = plant.f(state.map((v, i) => v + hs * k3[i]), u, tt + hs);
        state = state.map((v, i) => v + (hs / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
      }
    };
  } else {
    const S = toStateSpace(plant);
    const delaySamples = Math.round((plant.delay || S.delay || 0) / Ts);
    const buf = new Array(delaySamples).fill(0);
    state = (o.x0 || new Array(S.n).fill(0)).slice();
    const disc = S.n ? zohMatrices(S.A, S.B, Ts) : null;
    let uApplied = 0;
    outPlant = () => (S.n ? mVec(S.C, state)[0] : 0) + S.D[0][0] * uApplied;
    stepPlant = (u) => {
      let ue = u;
      if (delaySamples) { buf.push(u); ue = buf.shift(); }
      uApplied = ue;
      if (S.n) {
        const a = mVec(disc.Ad, state), b = mVec(disc.Bd, [ue]);
        state = a.map((v, i) => v + b[i]);
      }
    };
  }

  const out = {};
  for (const k of ['t', 'r', 'y', 'ym', 'u', 'uUnsat', 'e', 'P', 'I', 'D', 'dLoad']) out[k] = new Float64Array(N + 1);
  out.saturated = new Uint8Array(N + 1);
  for (let k = 0; k <= N; k++) {
    const t = k * Ts;
    const r = rf(t);
    const y = outPlant() + dof(t);
    const ym = y + (gauss ? sig * gauss() : 0);
    let res;
    if (isCtrlFn) { const u = o.controller(r, ym, k, t); res = { u, uUnsat: u, P: 0, I: 0, D: 0, saturated: false }; }
    else res = ctl.update(r, ym);
    const d = dl(t);
    out.t[k] = t; out.r[k] = r; out.y[k] = y; out.ym[k] = ym; out.u[k] = res.u; out.uUnsat[k] = res.uUnsat;
    out.e[k] = r - y; out.P[k] = res.P; out.I[k] = res.I; out.D[k] = res.D; out.dLoad[k] = d; out.saturated[k] = res.saturated ? 1 : 0;
    if (k < N) stepPlant(res.u + d, t);
  }
  out.indices = performanceIndices(out.t, out.e);
  out.totalVariation = totalVariation(out.u);
  out.Ts = Ts;
  return out;
}

/** Convenience: step-response specs (overshoot, settling, ...) of a simulateLoop result with a constant reference. */
export function loopStepInfo(res) {
  return stepInfo(res.t, res.y, { final: res.r[res.r.length - 1] });
}

// ------------------------------------------------------------------ identification (FOPDT)

/**
 * First-order-plus-dead-time fit K e^{-Ls}/(T s + 1) from a step response using two points (28.3% and 63.2% of the final
 * change; exact for a true FOPDT). `amp` is the input step size. Returns {K, T, L}.
 */
export function fitFopdt(t, y, { amp = 1, y0 = y[0], final = y[y.length - 1] } = {}) {
  const dy = final - y0;
  const when = (frac) => {
    for (let k = 1; k < y.length; k++) {
      const a = (y[k - 1] - y0) / dy, b = (y[k] - y0) / dy;
      if (a < frac && b >= frac) return t[k - 1] + ((frac - a) / (b - a)) * (t[k] - t[k - 1]);
    }
    return NaN;
  };
  const p1 = 0.283, p2 = 0.632;
  const t1 = when(p1), t2 = when(p2);
  const x1 = -Math.log(1 - p1), x2 = -Math.log(1 - p2);
  const T = (t2 - t1) / (x2 - x1);
  return { K: dy / amp, T, L: Math.max(0, t2 - T * x2) };
}

/**
 * Tangent (reaction-curve) method: the steepest point of the step response gives the slope R = max dy/dt / amp
 * and the apparent dead time L (intercept of the tangent with the initial value).
 * Returns {R, L, T, K}: T and K from the tangent reaching the final value (T = K / R) when a final value is given.
 */
export function reactionCurve(t, y, { amp = 1, y0 = y[0], final = y[y.length - 1] } = {}) {
  let best = 0, kb = 1;
  for (let k = 1; k < y.length; k++) {
    const s = (y[k] - y[k - 1]) / (t[k] - t[k - 1]);
    if (s > best) { best = s; kb = k; }
  }
  const tm = 0.5 * (t[kb] + t[kb - 1]), ym = 0.5 * (y[kb] + y[kb - 1]);
  const L = tm - (ym - y0) / best;
  const K = (final - y0) / amp;
  const R = best / amp;
  return { R, L, K, T: K / R };
}

/** FOPDT parameters of a TF found from its simulated step response (Smith two-point). */
export function fopdtOfTf(G, opts = {}) {
  const r = stepResponse(G, { n: 4000, ...opts });
  const g = dcGain(toTf(G));
  return fitFopdt(r.t, r.y, { final: opts.final ?? (Number.isFinite(g) ? g : undefined) });
}

// ------------------------------------------------------------------ tuning rules

const out = (Kp, Ti, Td, rule, type) => ({ Kp, Ti, Td, Ki: Number.isFinite(Ti) ? Kp / Ti : 0, Kd: Kp * Td, rule, type });

/**
 * Ziegler-Nichols reaction-curve (open-loop step) rules. Input {K, T, L} (FOPDT) or {R, L} (slope and dead time);
 * a = R L = K L / T. P: Kp = 1/a; PI: 0.9/a, Ti = 3.33 L; PID: 1.2/a, Ti = 2 L, Td = 0.5 L.
 */
export function zieglerNicholsStep(m, type = 'PID') {
  const R = m.R ?? m.K / m.T, L = m.L, a = R * L;
  if (type === 'P') return out(1 / a, Infinity, 0, 'ZN-step', type);
  if (type === 'PI') return out(0.9 / a, L / 0.3, 0, 'ZN-step', type);
  return out(1.2 / a, 2 * L, 0.5 * L, 'ZN-step', type);
}

/**
 * Ziegler-Nichols ultimate-cycle rules from the ultimate gain Ku and period Pu.
 * P: 0.5 Ku; PI: 0.45 Ku, Ti = Pu/1.2; PID: 0.6 Ku, Ti = Pu/2, Td = Pu/8.
 */
export function zieglerNicholsUltimate({ Ku, Pu }, type = 'PID') {
  if (type === 'P') return out(0.5 * Ku, Infinity, 0, 'ZN-ultimate', type);
  if (type === 'PI') return out(0.45 * Ku, Pu / 1.2, 0, 'ZN-ultimate', type);
  return out(0.6 * Ku, Pu / 2, Pu / 8, 'ZN-ultimate', type);
}

/**
 * Ultimate gain and period of a plant under proportional feedback. Without delay the first imaginary-axis crossing of
 * the root locus (Routh/jw analysis) is used; with delay, the phase crossover of the frequency response.
 * Returns {Ku, wu, Pu} or null when the loop never becomes marginally stable.
 */
export function ultimateFromTf(G) {
  G = toTf(G);
  if (!G.delay) {
    const c = imaginaryAxisCrossings(G).find((x) => x.w > 0);
    return c ? { Ku: c.K, wu: c.w, Pu: (2 * Math.PI) / c.w } : null;
  }
  const m = margins(G);
  return m.phaseCrossovers.length && Number.isFinite(m.gm) ? { Ku: m.gm, wu: m.wpc, Pu: (2 * Math.PI) / m.wpc } : null;
}

/** Cohen-Coon rules for FOPDT {K, T, L}; type 'P' | 'PI' | 'PD' | 'PID'. */
export function cohenCoon({ K, T, L }, type = 'PID') {
  const tau = L / T, g = T / (K * L);
  if (type === 'P') return out(g * (1 + tau / 3), Infinity, 0, 'Cohen-Coon', type);
  if (type === 'PI') return out(g * (0.9 + tau / 12), (L * (30 + 3 * tau)) / (9 + 20 * tau), 0, 'Cohen-Coon', type);
  if (type === 'PD') return out(g * (1.25 + tau / 6), Infinity, (L * (6 - 2 * tau)) / (22 + 3 * tau), 'Cohen-Coon', type);
  return out(g * (4 / 3 + tau / 4), (L * (32 + 6 * tau)) / (13 + 8 * tau), (4 * L) / (11 + 2 * tau), 'Cohen-Coon', type);
}

/**
 * IMC / lambda tuning for FOPDT {K, T, L} with desired closed-loop time constant lambda (Rivera et al.):
 * PI: Kp = T / (K (lambda + L)), Ti = T  (dead time folded as (lambda + L));
 * PID: Kp = (T + L/2) / (K (lambda + L/2)), Ti = T + L/2, Td = T L / (2 T + L).
 */
export function imcLambda({ K, T, L }, lambda, type = 'PI') {
  if (type === 'PID') return out((T + L / 2) / (K * (lambda + L / 2)), T + L / 2, (T * L) / (2 * T + L), `IMC(lambda=${lambda})`, type);
  return out(T / (K * (lambda + L)), T, 0, `IMC(lambda=${lambda})`, 'PI');
}

/**
 * Skogestad SIMC rules for {K, T (dominant lag), L} with optional second lag T2: tauC (default L) is the closed-loop
 * time constant; Ti = min(T, 4 (tauC + L)). PI: Kp = T / (K (tauC + L)). PID (series form Kc (1+1/(Ti s))(1+Td s), Td = T2) is
 * also returned as an ideal-form controller.
 */
export function simc({ K, T, L, T2 = 0 }, tauC = L, type = 'PI') {
  const Ti = Math.min(T, 4 * (tauC + L));
  const Kc = T / (K * (tauC + L));
  if (type === 'PID') {
    const ideal = serialToIdeal({ Kc, Ti, Td: T2 });
    return { ...out(ideal.Kp, ideal.Ti, ideal.Td, `SIMC(tauC=${tauC})`, 'PID'), serial: { Kc, Ti, Td: T2 } };
  }
  return out(Kc, Ti, 0, `SIMC(tauC=${tauC})`, 'PI');
}

/** Turn a tuning result into the parameter object used by pidTf / createPid / simulateLoop. */
export function toPidParams(t, extra = {}) {
  return { Kp: t.Kp, Ki: t.Ki, Kd: t.Kd, ...extra };
}
