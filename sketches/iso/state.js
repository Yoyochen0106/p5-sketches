// Settings defaults, field resolution and presets for the Marching Squares & Cubes sketch.
import { FIELDS_2D, FIELDS_3D } from '../../lib/fields.js';
import { compileField } from '../../lib/expr.js';
import { levelRange, uFromLevel, levelFromU } from '../../lib/iso-inspect.js';

export const DEFAULTS = {
  mode: '2d',
  // 2D
  f2: 'metaballs4', expr2: 'sin(x) * cos(y) + 0.3 * sin(t)', res2: 32, lu2: null,
  bg: true, contour: 'levels', lattice: true, grad: false, time: 0, animT: false,
  // 3D
  f3: 'torus', expr3: 'x^2 + y^2 + z^2 - 1 + 0.4 * sin(3 * x) * sin(3 * y) * sin(3 * z)', res3: 28, lu3: null,
  algo: 'tetra', render: 'flat', colorBy: 'height', box: true, axes: true, floor: true, holes: true,
  caseIdx: 1, showCase: true, slice: false, sliceU: 0.5, sliceClip: true,
  // shared
  interp: true, disamb: true, sweep: false, sweepSpeed: 1, presetId: '',
};

/** Extra 2D field with a time parameter: metaballs drifting on Lissajous orbits. */
function drifting(x, y, t) {
  const balls = [[0.9, 0.6, 0.7, 0.55], [0.8, 0.9, 1.1, 0.5], [0.6, 1.3, 0.8, 0.45], [0.5, 0.7, 1.6, 0.4]];
  let s = 0;
  balls.forEach(([r, fx, fy, ph], n) => {
    const bx = r * Math.cos(fx * t + ph * n * 3), by = r * Math.sin(fy * t + ph * 2);
    s += (0.32 + 0.04 * n) / ((x - bx) ** 2 + (y - by) ** 2 + 1e-3);
  });
  return 1 - s;
}

export const DRIFT_FIELD = {
  id: 'drift', label: 'Drifting metaballs (animated)', dim: 2, timeDep: true, f: drifting,
  bounds: { xmin: -2, xmax: 2, ymin: -2, ymax: 2 }, level: 0, levels: [-2, -1, -0.5, 0, 0.5, 0.8],
};

export const CATALOGUE_2D = [...FIELDS_2D, DRIFT_FIELD];
export const CATALOGUE_3D = FIELDS_3D;

const CUSTOM_BOUNDS_2D = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
const CUSTOM_BOUNDS_3D = { xmin: -2, xmax: 2, ymin: -2, ymax: 2, zmin: -2, zmax: 2 };
/** Custom expressions are interpreted (slow per sample): cap the 3D resolution. */
export const CUSTOM_MAX_RES3 = 56;

/** Syntax check for the expression text boxes; returns an error message or null. */
export function validateExpression(text, dim) {
  try {
    const fn = compileField(String(text), dim === 2 ? ['x', 'y', 't'] : ['x', 'y', 'z']);
    const v = dim === 2 ? fn(0.3, 0.7, 0.1) : fn(0.3, 0.7, 0.1);
    if (typeof v !== 'number') return 'expression must be real-valued';
    return null;
  } catch (e) {
    return String((e && e.message) || e);
  }
}

function percentileRange(values, lo = 0.05, hi = 0.95) {
  const v = Array.from(values).filter((x) => Number.isFinite(x) && Math.abs(x) < 1e6).sort((a, b) => a - b);
  if (!v.length) return [-1, 1];
  return [v[Math.floor(lo * (v.length - 1))], v[Math.floor(hi * (v.length - 1))]];
}

/**
 * Field descriptor for the current settings:
 *   { dim, key, id, label, custom, timeDep, f(x, y[, z], t?), bounds, level, levels, range }
 * `f` for 2D takes (x, y, t). `error` is set when a custom expression does not compile (the first
 * catalogue field is used instead).
 */
export function resolveField(dim, get) {
  const catalogue = dim === 2 ? CATALOGUE_2D : CATALOGUE_3D;
  const id = get(dim === 2 ? 'f2' : 'f3');
  if (id === 'custom') {
    const text = String(get(dim === 2 ? 'expr2' : 'expr3'));
    try {
      const fn = compileField(text, dim === 2 ? ['x', 'y', 't'] : ['x', 'y', 'z']);
      const bounds = dim === 2 ? CUSTOM_BOUNDS_2D : CUSTOM_BOUNDS_3D;
      const d = { dim, id: 'custom', label: text, custom: true, f: fn, bounds, timeDep: dim === 2 && /\bt\b/.test(text), key: `custom:${dim}:${text}` };
      // sample a coarse grid for a sensible level range and default
      const probe = [];
      const n = dim === 2 ? 24 : 10;
      const b = bounds;
      for (let k = 0; k <= (dim === 2 ? 0 : n); k++) {
        for (let j = 0; j <= n; j++) {
          for (let i = 0; i <= n; i++) {
            const x = b.xmin + ((b.xmax - b.xmin) * i) / n, y = b.ymin + ((b.ymax - b.ymin) * j) / n;
            probe.push(dim === 2 ? fn(x, y, 0) : fn(x, y, b.zmin + ((b.zmax - b.zmin) * k) / n));
          }
        }
      }
      const [lo, hi] = percentileRange(probe, 0.1, 0.9);
      const level = lo < 0 && hi > 0 ? 0 : (lo + hi) / 2;
      const levels = [lo, (lo + level) / 2, level, (level + hi) / 2, hi].map((v) => Number(v.toPrecision(3)));
      return { ...d, level: Number(level.toPrecision(3)) || 0, levels, range: levelRange(levels, level) };
    } catch (e) {
      const d = resolveFallback(dim, catalogue);
      return { ...d, error: String((e && e.message) || e) };
    }
  }
  const d = catalogue.find((c) => c.id === id) || catalogue[0];
  return describe(dim, d);
}

function describe(dim, d) {
  return {
    dim, id: d.id, label: d.label, custom: false, timeDep: !!d.timeDep, f: d.f, bounds: d.bounds, level: d.level, levels: d.levels,
    range: levelRange(d.levels, d.level), key: `cat:${d.id}`,
  };
}

function resolveFallback(dim, catalogue) {
  return describe(dim, catalogue[0]);
}

/** Wraps a field into a plain sampling function (x, y) or (x, y, z) at time t. */
export function sampler(field, t = 0) {
  if (field.dim === 2) return (x, y) => field.f(x, y, t);
  return field.f;
}

/** Active iso-level for slider position u (falls back to the field default when u is unset). */
export function activeLevel(field, u) {
  return Number.isFinite(u) ? levelFromU(u, field.range) : field.level;
}

export function defaultU(field) {
  return uFromLevel(field.level, field.range);
}

// ---------------------------------------------------------------------------------------------
// Presets: interesting (field, level) combinations

export const PRESETS = [
  {
    id: 'saddle2d', label: '2D: ambiguous saddle', mode: '2d', field: 'saddle', level: 0, res: 8, disamb: false, interp: true,
    caption: 'x^2 - y^2 = 0 has a saddle at the origin. With a coarse grid the cells 5 / 10 are ambiguous: toggle "saddle disambiguation" and compare.',
  },
  {
    id: 'balls2d', label: '2D: metaballs merging', mode: '2d', field: 'metaballs2', level: -0.5, res: 60, sweep: true,
    caption: 'Two metaballs: raise the level and the two blobs merge through a neck (a saddle of the field).',
  },
  {
    id: 'drift2d', label: '2D: drifting metaballs', mode: '2d', field: 'drift', level: 0, res: 80, animT: true, contour: 'single',
    caption: 'Time-dependent field: the contour is recomputed every frame from a fresh grid sample.',
  },
  {
    id: 'himmelblau', label: '2D: Himmelblau valleys', mode: '2d', field: 'himmelblau', level: 10, res: 120, contour: 'levels',
    caption: 'Four minima of Himmelblau\'s function; contours at several levels, gradient arrows point uphill.', grad: true,
  },
  {
    id: 'torus', label: '3D: torus', mode: '3d', field: 'torus', level: 0, res: 40, algo: 'classic',
    caption: 'Torus (x^2+y^2+z^2+R^2-r^2)^2 = 4R^2(x^2+y^2): genus 1. Drag the slice plane through it to see one or two circles.',
  },
  {
    id: 'gyroid', label: '3D: gyroid', mode: '3d', field: 'gyroid', level: 0, res: 48, algo: 'tetra',
    caption: 'Gyroid sin x cos y + sin y cos z + sin z cos x = 0: a triply periodic minimal surface. Red edges mark open boundaries.',
  },
  {
    id: 'balls3d', label: '3D: metaballs merging', mode: '3d', field: 'metaballs3', level: -0.6, res: 40, algo: 'tetra', sweep: true,
    caption: 'Four metaballs: as the level sweeps up the blobs touch, grow necks and fuse into one body.',
  },
  {
    id: 'barth', label: '3D: Barth sextic', mode: '3d', field: 'barth', level: 0, res: 56, algo: 'tetra',
    caption: 'Barth sextic with 65 nodes and icosahedral symmetry. Classic marching cubes may leave cracks near the nodes.',
  },
  {
    id: 'sh42', label: '3D: spherical harmonic lobes', mode: '3d', field: 'sh42', level: 0, res: 44, algo: 'tetra', colorBy: 'normal',
    caption: 'Lobe surface r = |Y(4,2)| from a spherical harmonic.',
  },
  {
    id: 'noise3', label: '3D: noise cracks', mode: '3d', field: 'noise3', level: 0, res: 28, algo: 'classic',
    caption: 'Noisy field with the classic table: ambiguous faces leave cracks (red). Switch the algorithm to tetra and they vanish.',
  },
];
