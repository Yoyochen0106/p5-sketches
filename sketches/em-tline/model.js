// Derived quantities of the transmission-line unit (pure; no p5).
import * as T from '../../lib/em/tline.js';
import * as C from '../../lib/complex.js';

export const DEFAULTS = {
  tab: 'smith',
  // line and load
  z0: 50, zr: 100, zx: 50, f: 300, vf: 0.66, loss: 0, lenM: 1,
  // smith
  dLam: 0.125, showY: true, sweep: false, pins: '',
  // standing waves
  wSpeed: 1, wInc: true, wRef: true, wTot: true, wEnv: true,
  // matching
  mMethod: 'stub', mType: 'short', stubD: 0.1, stubL: 0.1, qwAt: 'max', lSol: 0, rlThr: 10,
  // pulse
  zs: 10, pzl: 1e9, pshape: 'step', pwid: 2, pspeed: 1, ploop: true,
};

export const TABS = [
  { value: 'smith', label: 'Smith chart' },
  { value: 'waves', label: 'Standing waves' },
  { value: 'match', label: 'Matching' },
  { value: 'pulse', label: 'Pulse (time domain)' },
];

/**
 * Everything derived from the line / load settings. `get` reads a setting.
 */
export function lineNow(get) {
  const z0 = Math.max(1, Number(get('z0')) || 50);
  const zl = [Math.max(0, Number(get('zr')) || 0), Number(get('zx')) || 0];
  const f = Math.max(1, Number(get('f')) || 300) * 1e6;
  const vf = Math.min(1, Math.max(0.1, Number(get('vf')) || 1));
  const lossDbPerM = Math.max(0, Number(get('loss')) || 0);
  const lenM = Math.max(0.01, Number(get('lenM')) || 1);
  const prop = T.propagation({ f, vf, alpha: lossDbPerM / 8.685889638 });
  const gL = T.loadGamma(zl, z0);
  const gMag = C.abs(gL);
  const gPhi = Math.atan2(gL[1], gL[0]);
  const zn = [zl[0] / z0, zl[1] / z0];
  // attenuation per wavelength (nepers) -> complex gamma in per-wavelength units
  const alphaLam = prop.alpha * prop.wavelength;
  return {
    z0, zl, zn, gL, gMag, gPhi, f, vf, lossDbPerM, lenM, prop,
    lam: prop.wavelength, gammaLam: [alphaLam, 2 * Math.PI], alphaLam,
    lenLam: lenM / prop.wavelength,
    vswr: T.vswr(gMag), rl: T.returnLossDb(gMag), ml: T.mismatchLossDb(gMag),
    y: C.div([1, 0], zn),
  };
}

/** Gamma at d wavelengths from the load, including the line loss. */
export function gammaAtLam(L, dLam) { return T.gammaAt(L.gL, L.gammaLam, dLam); }

/** Zin (ohms) at d wavelengths from the load. */
export function zinAtLam(L, dLam) { return T.zin(L.zl, L.z0, L.gammaLam, dLam); }

/** Parses 'r,x;r,x' pins into [{r, x}] (ohms). */
export function parsePins(s) {
  if (!s || typeof s !== 'string') return [];
  return s.split(';').map((q) => q.split(',').map(Number)).filter((a) => a.length === 2 && a.every(Number.isFinite)).slice(0, 12).map(([r, x]) => ({ r, x }));
}
export function formatPins(pins) { return pins.map((q) => `${Math.round(q.r * 10) / 10},${Math.round(q.x * 10) / 10}`).join(';'); }

/** Impedance text like '100 + j50' (ohms). */
export function zText(z, d = 4) {
  const f = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(d))) : v > 0 ? 'inf' : '-inf');
  return `${f(z[0])} ${z[1] < 0 ? '-' : '+'} j${f(Math.abs(z[1]))}`;
}
export const ang = (z) => (Math.atan2(z[1], z[0]) * 180) / Math.PI;

/** Numerically locates the extrema of |V(d)| on [0, len] wavelengths; returns { maxima, minima } (d in wavelengths). */
export function envelopeExtrema(L, lenLam, n = 800) {
  const mags = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) mags[i] = T.lineWaves(L.gL, L.gammaLam, (lenLam * i) / n).vMag;
  const maxima = [], minima = [];
  let lo = Infinity, hi = 0;
  for (let i = 0; i <= n; i++) { if (mags[i] < lo) lo = mags[i]; if (mags[i] > hi) hi = mags[i]; }
  if (hi - lo < 1e-6 * Math.max(1, hi)) return { maxima, minima, mags }; // flat envelope (matched line)
  for (let i = 1; i < n; i++) {
    if (mags[i] > mags[i - 1] && mags[i] >= mags[i + 1]) maxima.push((lenLam * i) / n);
    else if (mags[i] < mags[i - 1] && mags[i] <= mags[i + 1]) minima.push((lenLam * i) / n);
  }
  return { maxima, minima, mags };
}

/** The matching network currently selected in the Matching tab: { kind, label, gammaAt(fr), path(), info[] } or null. */
export function matchingNow(L, get) {
  const method = get('mMethod');
  const type = get('mType') === 'open' ? 'open' : 'short';
  const zl = L.zl, z0 = L.z0;
  if (method === 'qw') {
    const sol = T.quarterWaveMatch(zl, z0, get('qwAt') === 'min' ? 'min' : 'max');
    if (!sol) return { kind: 'qw', sol: null, gammaAt: () => L.gMag, path: () => [], info: ['no quarter-wave solution (|Gamma| = 1)'] };
    return {
      kind: 'qw', sol,
      gammaAt: (fr) => T.quarterWaveMatchGamma(zl, z0, sol, fr),
      path() {
        const pts = [];
        for (let i = 0; i <= 60; i++) pts.push(T.zToGamma(C.scale(T.zinLossless(zl, z0, 2 * Math.PI * sol.dLambda * (i / 60)), 1 / z0)));
        const zr = T.zinLossless(zl, z0, 2 * Math.PI * sol.dLambda);
        for (let i = 1; i <= 60; i++) pts.push(T.zToGamma(C.scale(T.zinLossless(zr, sol.zt, (Math.PI / 2) * (i / 60)), 1 / z0)));
        return pts;
      },
      info: [
        `slide ${sol.dLambda.toFixed(4)} lambda to a voltage ${get('qwAt') === 'min' ? 'minimum' : 'maximum'}: Zin = ${sol.rin.toFixed(2)} ohm (real)`,
        `then a lambda/4 section with Zt = sqrt(Z0 Rin) = ${sol.zt.toFixed(2)} ohm`,
      ],
    };
  }
  if (method === 'lmatch') {
    const sols = T.lMatch(zl, z0);
    const sol = sols[Math.min(sols.length - 1, Math.max(0, Math.round(Number(get('lSol')) || 0)))];
    if (!sol) return { kind: 'lmatch', sol: null, gammaAt: () => L.gMag, path: () => [], info: ['no L-section solution for this load (needs R > 0)'] };
    const eX = T.elementFor('X', sol.X, L.f), eB = T.elementFor('B', sol.B, L.f);
    const unit = (e) => (e.type === 'L' ? `${(e.value * 1e9).toFixed(2)} nH` : `${(e.value * 1e12).toFixed(2)} pF`);
    return {
      kind: 'lmatch', sol,
      gammaAt: (fr) => T.lMatchGamma(zl, z0, sol, fr),
      path() {
        const pts = [];
        const n = 40;
        if (sol.topology === 'shunt-load') {
          for (let i = 0; i <= n; i++) pts.push(T.zToGamma(C.scale(C.div([1, 0], C.add(C.div([1, 0], zl), [0, (sol.B * i) / n])), 1 / z0)));
          const z1 = C.div([1, 0], C.add(C.div([1, 0], zl), [0, sol.B]));
          for (let i = 1; i <= n; i++) pts.push(T.zToGamma(C.scale(C.add(z1, [0, (sol.X * i) / n]), 1 / z0)));
        } else {
          for (let i = 0; i <= n; i++) pts.push(T.zToGamma(C.scale(C.add(zl, [0, (sol.X * i) / n]), 1 / z0)));
          const z1 = C.add(zl, [0, sol.X]);
          for (let i = 1; i <= n; i++) pts.push(T.zToGamma(C.scale(C.div([1, 0], C.add(C.div([1, 0], z1), [0, (sol.B * i) / n])), 1 / z0)));
        }
        return pts;
      },
      info: [
        sol.topology === 'shunt-load'
          ? `shunt ${eB.type} ${unit(eB)} across the load, then series ${eX.type} ${unit(eX)}`
          : `series ${eX.type} ${unit(eX)} next to the load, then shunt ${eB.type} ${unit(eB)}`,
        `X = ${sol.X.toFixed(2)} ohm, B = ${(sol.B * 1000).toFixed(3)} mS at ${(L.f / 1e6).toFixed(0)} MHz`,
      ],
    };
  }
  // single stub: manual d, l (wavelengths)
  const sol = { dLambda: Number(get('stubD')) || 0, lLambda: Number(get('stubL')) || 0 };
  return {
    kind: 'stub', sol, type,
    gammaAt: (fr) => T.singleStubGamma(zl, z0, sol, type, fr),
    path() {
      const pts = [];
      const zn = C.scale(zl, 1 / z0);
      for (let i = 0; i <= 60; i++) pts.push(T.zToGamma(T.zinLossless(zn, 1, 2 * Math.PI * sol.dLambda * (i / 60))));
      const y0 = C.div([1, 0], T.zinLossless(zn, 1, 2 * Math.PI * sol.dLambda));
      const b = T.stubSusceptance(sol.lLambda, type);
      for (let i = 1; i <= 60; i++) pts.push(T.zToGamma(C.div([1, 0], C.add(y0, [0, (b * i) / 60]))));
      return pts;
    },
    solutions: T.singleStub(zl, z0, type),
    info: [
      `stub at d = ${sol.dLambda.toFixed(4)} lambda, ${type}-circuited, l = ${sol.lLambda.toFixed(4)} lambda`,
    ],
  };
}
