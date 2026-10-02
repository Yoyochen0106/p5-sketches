// Settings defaults and small helpers for the Surface Curvature & Geodesics sketch.
import { SURFACE_DEFS } from '../../lib/surfaces.js';

export const COLOR_MODES = [
  { value: 'K', label: 'Gaussian curvature K' },
  { value: 'H', label: 'mean curvature H' },
  { value: 'solid', label: 'solid' },
];
export const RENDER_MODES = [
  { value: 'flat', label: 'flat' },
  { value: 'both', label: 'flat + mesh wire' },
  { value: 'wire', label: 'wireframe' },
];
export const LOOPS = [
  { value: 'none', label: 'none' },
  { value: 'parallel', label: 'parallel circle (v = const)' },
  { value: 'circle', label: 'small circle in the chart' },
  { value: 'triangle', label: 'geodesic triangle' },
];

/** Settings key of parameter `key` of surface `id`. */
export const paramKey = (id, key) => `s.${id}.${key}`;

export const DEFAULTS = {
  surface: 'torus',
  resolution: 56,
  colorBy: 'K',
  render: 'flat',
  paramLines: false,
  axes: true,
  orbitOnly: false,
  // start point (fractions of the parameter domain), initial direction and length
  su: 0.18, sv: 0.32,
  theta: 35, // degrees in the tangent frame (e1 = d/du direction)
  length: 2, // geodesic length in units of the surface size
  fan: false, fanCount: 12,
  bead: true, beadSpeed: 1,
  // second point
  target: false, tu: 0.62, tv: 0.58,
  // loops / triangles
  loop: 'none', loopV: 0.35, loopR: 0.12,
  triAlpha: 70, triAB: 0.8, triAC: 0.7,
  // overlays
  curvLines: false, dupin: false,
};

for (const d of SURFACE_DEFS) for (const s of d.params) DEFAULTS[paramKey(d.id, s.key)] = s.def;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const fmt = (v, d = 4) => (Number.isFinite(v) ? String(Number(v.toPrecision(d))) : '-');
export const deg = (r) => (r * 180) / Math.PI;
