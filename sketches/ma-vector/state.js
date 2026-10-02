// Defaults, small helpers and the field models (preset or typed expression) of the vector calculus unit.
//
// Public settings (deep-link keys), all optional:
//   tab        'field2' | 'green' | 'field3' | 'potential'
//   src        2D field source 'preset' | 'expr'          f2   preset id (see PRESETS_2D)
//   fx, fy     typed 2D components in x, y (used when src = 'expr')
//   px, py     probe position
//   gshape     'circle' | 'ellipse' | 'rect' | 'poly', gcx gcy gr gb grot (centre, size, aspect, rotation deg),
//              gorient 'ccw' | 'cw', gpoly "x,y;x,y;..." (free polygon), gcells (0..16), gmode 'theorem' | 'path'
//   src3       'preset' | 'expr'    f3  3D preset id   gx, gy, gz  typed 3D components in x, y, z
//   surf       'sphere' | 'cube' | 'cylinder' (+ sx sy sz centre, ssize)   lr lh (loop radius, cap height)
//   pmode      'potential' | 'helmholtz'   bx by (base point of the potential)

import {
  PRESETS_2D, PRESETS_3D, makeField2, makeField3,
} from '../../lib/vectorcalc.js';
import { compileField } from '../../lib/expr.js';

export const TABS = [
  { value: 'field2', label: '2D field' },
  { value: 'green', label: 'Green / Stokes' },
  { value: 'field3', label: '3D field' },
  { value: 'potential', label: 'Potential' },
];

export const DEFAULTS = {
  tab: 'field2',
  // 2D field
  src: 'preset', f2: 'swirl', fx: '-y + 0.2*x', fy: 'x*(1 - y^2/4)',
  showArrows: true, normalize: false, showStream: true, showLic: false, colorBy: 'curl', arrowDensity: 22, stepExp: -4,
  probeAnim: true, px: 1, py: 0.6,
  // Green / Stokes
  gmode: 'theorem', gshape: 'circle', gcx: 0.2, gcy: 0.1, gr: 1.4, gb: 0.6, grot: 20, gorient: 'ccw',
  gpoly: '-1.2,-1;1.4,-0.8;1.8,0.6;0.2,1.5;-1.5,0.7', gcells: 6, gshowCells: true, gcancel: true, gcolor: 'curl',
  gax: -1.8, gay: -0.9, gbx: 1.8, gby: 1.0, gbulge: 0.6,
  // 3D
  src3: 'preset', f3: 'poly', gx: 'x*y', gy: 'y*z', gz: 'z*x', glyphN: 6, showStream3: true, seeds3: 18, normalize3: false,
  surf: 'sphere', sx: 0.3, sy: 0, sz: 0, ssize: 1.2, showSurf: true, showLoop: true,
  lcx: 0, lcy: 0, lcz: 0.3, lnth: 40, lnph: 30, lr: 1.1, lh: 0.8, slice: 'div', sliceZ: 0,
  // potential
  pmode: 'potential', pwhat: 'auto', bx: 0, by: 0, levels: 14, hn: 64, hsrc: 'field', hshow: 'arrows', blobKind: 'source',
  blobs: '-1.5,0.5,0.7,1,source;1.6,-0.8,0.7,1,vortex',
};

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function fmt(v, d = 4) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
  return String(Number(v.toPrecision(d)));
}

/** Rounds a number for storing in settings (keeps hash URLs short). */
export const rnd = (v, d = 3) => Number(v.toFixed(d));

/** Navigates to another unit, optionally pre-configured: openIn('ma-linalg', { A: '1,2;3,4' }). */
export function openIn(id, params = {}) {
  if (typeof location === 'undefined') return false;
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  location.hash = `#/${id}${q ? `?${q}` : ''}`;
  return true;
}

/** Validates an expression of the given variables; returns an error message or null. */
export function validateExpr(str, vars) {
  try {
    const f = compileField(String(str), vars);
    const v = f(0.31, 0.47, 0.23);
    if (typeof v !== 'number') return 'does not evaluate to a number';
    return null;
  } catch (e) {
    return String((e && e.message) || e);
  }
}

const ZERO2 = () => [0, 0];
const ZERO3 = () => [0, 0, 0];

/** Current 2D field model: { key, id, label, caption, field, error, analytic }. */
export function model2(get) {
  const src = get('src');
  if (src === 'expr') {
    const fxs = String(get('fx')), fys = String(get('fy'));
    const key = `expr|${fxs}|${fys}`;
    let f = ZERO2, error = null;
    try {
      const a = compileField(fxs, ['x', 'y']), b = compileField(fys, ['x', 'y']);
      f = (x, y) => [a(x, y), b(x, y)];
    } catch (e) { error = String((e && e.message) || e); }
    return {
      key, id: 'expr', label: `F = (${fxs}, ${fys})`, caption: 'Typed field. Derivatives are numerical (central differences, step in the drawer).',
      field: makeField2(f), error, analytic: false, preset: false,
    };
  }
  const p = PRESETS_2D.find((q) => q.id === get('f2')) || PRESETS_2D[0];
  return { key: `preset|${p.id}`, id: p.id, label: p.label, caption: p.caption, field: makeField2(p.f, p.jac || null), error: null, analytic: !!p.jac, preset: true };
}

/** Current 3D field model. */
export function model3(get) {
  const src = get('src3');
  if (src === 'expr') {
    const s = [get('gx'), get('gy'), get('gz')].map(String);
    const key = `expr3|${s.join('|')}`;
    let f = ZERO3, error = null;
    try {
      const c = s.map((e) => compileField(e, ['x', 'y', 'z']));
      f = (x, y, z) => [c[0](x, y, z), c[1](x, y, z), c[2](x, y, z)];
    } catch (e) { error = String((e && e.message) || e); }
    return {
      key, id: 'expr', label: `F = (${s.join(', ')})`, caption: 'Typed field, numerical derivatives.', field: makeField3(f), error, analytic: false,
    };
  }
  const p = PRESETS_3D.find((q) => q.id === get('f3')) || PRESETS_3D[0];
  return { key: `preset3|${p.id}`, id: p.id, label: p.label, caption: p.caption, field: makeField3(p.f, p.jac || null), error: null, analytic: !!p.jac };
}

/** Parses "x,y;x,y;..." into points (invalid entries dropped). */
export function parsePoly(str) {
  return String(str || '').split(';').map((s) => s.split(',').map(Number)).filter((a) => a.length === 2 && a.every(Number.isFinite));
}
export const formatPoly = (pts) => pts.map((q) => `${rnd(q[0], 2)},${rnd(q[1], 2)}`).join(';');

/** Parses "x,y,s,a,kind;..." into blob objects. */
export function parseBlobs(str) {
  return String(str || '').split(';').map((s) => s.split(',')).filter((a) => a.length >= 5)
    .map((a) => ({ x: Number(a[0]), y: Number(a[1]), s: Number(a[2]), a: Number(a[3]), kind: a[4] === 'vortex' ? 'vortex' : 'source' }))
    .filter((b) => [b.x, b.y, b.s, b.a].every(Number.isFinite) && b.s > 0.05);
}
export const formatBlobs = (bs) => bs.map((b) => `${rnd(b.x, 2)},${rnd(b.y, 2)},${rnd(b.s, 2)},${rnd(b.a, 2)},${b.kind}`).join(';');
