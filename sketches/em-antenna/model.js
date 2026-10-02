// Settings defaults and derived quantities of the antenna-array unit (pure; no p5).
import * as A from '../../lib/em/array.js';
import { clamp, rad } from '../em-common/util.js';

export const DEFAULTS = {
  tab: 'linear',
  // linear array
  N: 10, d: 0.5, steer: 90, taper: 'uniform', sll: 30, elem: 'iso', w: '',
  brush: 1, polarDb: true, floor: 40, scan: false, scanSpeed: 1,
  // planar array
  Nx: 8, Ny: 8, dx: 0.5, dy: 0.5, pth: 0, pph: 0, pelem: 'iso', pfloor: 30, prender: 'both', paxes: true,
};

export const TABS = [
  { value: 'linear', label: 'Linear array' },
  { value: 'planar', label: 'Planar / 3D pattern' },
  { value: 'element', label: 'Element patterns' },
];

export const TAPER_OPTIONS = [...A.TAPERS, { id: 'custom', label: 'custom (edited bars)' }].map((t) => ({ value: t.id, label: t.label }));
export const LINEAR_ELEMENTS = [
  { value: 'iso', label: 'isotropic' },
  { value: 'short', label: 'short dipole  sinθ' },
  { value: 'half', label: 'half-wave dipole' },
];

/** Parses 'a,b,c' into amplitudes clamped to [0, 1]. */
export function parseWeights(s) {
  if (!s || typeof s !== 'string') return [];
  return s.split(',').map((v) => Number(v)).filter((v) => Number.isFinite(v)).map((v) => clamp(v, 0, 1));
}
export const formatWeights = (w) => Array.from(w, (v) => String(Math.round(v * 1000) / 1000)).join(',');

/** Linear resample of an array to n entries (ends map to ends). */
export function resampleTo(arr, n) {
  const out = new Float64Array(n);
  if (!arr.length) return out.fill(1);
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? (i * (arr.length - 1)) / (n - 1) : 0;
    const j = Math.floor(x), f = x - j;
    out[i] = arr[j] * (1 - f) + (arr[Math.min(arr.length - 1, j + 1)] || 0) * f;
  }
  return out;
}

/** Weights of the linear array from the settings. */
export function weightsNow(get) {
  const N = clamp(Math.round(Number(get('N')) || 2), 2, 32);
  const taper = get('taper');
  if (taper === 'custom') {
    const arr = parseWeights(get('w'));
    return arr.length === N ? Float64Array.from(arr) : resampleTo(arr, N);
  }
  return A.weightsFor(taper, N, Number(get('sll')) || 30);
}
/** Weights of one axis of the planar array. */
export function planarWeights(get, n) {
  return A.weightsFor(get('taper') === 'custom' ? 'uniform' : get('taper'), n, Number(get('sll')) || 30);
}

/**
 * Everything the linear tab displays. `wOverride`: live weights while a bar is dragged; `steerOverride`: scan angle (deg).
 */
export function linearNow(get, { wOverride = null, steerOverride = null } = {}) {
  const w = wOverride || weightsNow(get);
  const d = clamp(Number(get('d')) || 0.5, 0.05, 3);
  const steerDeg = steerOverride !== null ? steerOverride : clamp(Number(get('steer')), 0, 180);
  const beta = A.steeringBeta(d, rad(steerDeg));
  const elem = get('elem');
  const samples = A.sampleLinear(w, d, beta, elem, 720);
  const analysis = A.analyzePattern(samples);
  const sum = w.reduce((s, v) => s + v, 0);
  const spec = A.weightSpectrum(w, 1024);
  const grating = A.gratingAngles(d, beta);
  return { w, d, steerDeg, beta, elem, samples, analysis, sum, spec, grating, N: w.length };
}

export const dbOf = (x, floor) => A.toDb(x, -floor);
