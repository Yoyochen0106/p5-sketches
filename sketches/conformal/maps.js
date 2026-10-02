// Map catalogue for the Conformal Maps sketch. buildMap() turns a preset id plus the draggable parameters
// into { f(z), df(z), critical, special, cut, sig } where complex numbers are [re, im].

import { complexAlg } from '../../lib/algebra.js';
import {
    derivative, moebiusFrom3, applyMoebius, moebiusDerivative, polyFromRoots, evalPoly, criticalPoints,
} from '../../lib/conformal.js';

const one = (A) => A.const(1);
const sym = (r) => ({ xmin: -r, xmax: r, ymin: -r, ymax: r });
const range = (lo, hi) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

/**
 * Presets defined by a def(A, x). `critical(v)` lists the zeros of f' inside the view v, `special(v)` poles and branch
 * points, `cut` is true for principal branches with a cut along the negative real axis.
 */
const SIMPLE = [
    { id: 'z2', label: 'z²', def: (A, x) => A.mul(x, x), critical: () => [[0, 0]], dv: sym(2.5), iv: sym(6) },
    { id: 'z3', label: 'z³', def: (A, x) => A.mul(x, A.mul(x, x)), critical: () => [[0, 0]], dv: sym(2), iv: sym(8) },
    { id: 'sqrt', label: '√z (principal branch)', def: (A, x) => A.sqrt(x), special: () => [[0, 0]], cut: true, dv: sym(4), iv: sym(2.5) },
    { id: 'inv', label: '1/z (inversion)', def: (A, x) => A.div(one(A), x), special: () => [[0, 0]], dv: sym(2.5), iv: sym(3) },
    { id: 'exp', label: 'exp z', def: (A, x) => A.exp(x), dv: { xmin: -3, xmax: 3, ymin: -3.2, ymax: 3.2 }, iv: sym(6) },
    { id: 'log', label: 'log z (principal)', def: (A, x) => A.log(x), special: () => [[0, 0]], cut: true, dv: sym(5), iv: sym(4) },
    {
        id: 'sin', label: 'sin z', def: (A, x) => A.sin(x),
        critical: (v) => range(Math.floor(v.xmin / Math.PI), Math.ceil(v.xmax / Math.PI)).map((k) => [Math.PI / 2 + k * Math.PI, 0]),
        dv: { xmin: -4.5, xmax: 4.5, ymin: -3, ymax: 3 }, iv: sym(4),
    },
    {
        id: 'cos', label: 'cos z', def: (A, x) => A.cos(x),
        critical: (v) => range(Math.floor(v.xmin / Math.PI), Math.ceil(v.xmax / Math.PI)).map((k) => [k * Math.PI, 0]),
        dv: { xmin: -4.5, xmax: 4.5, ymin: -3, ymax: 3 }, iv: sym(4),
    },
    {
        id: 'tan', label: 'tan z', def: (A, x) => A.tan(x),
        special: (v) => range(Math.floor(v.xmin / Math.PI - 0.5), Math.ceil(v.xmax / Math.PI)).map((k) => [Math.PI / 2 + k * Math.PI, 0]),
        dv: { xmin: -3.5, xmax: 3.5, ymin: -2.4, ymax: 2.4 }, iv: sym(4),
    },
    {
        id: 'jouk', label: 'z + 1/z (Joukowski)', def: (A, x) => A.add(x, A.div(one(A), x)),
        critical: () => [[1, 0], [-1, 0]], special: () => [[0, 0]], dv: sym(2.5), iv: sym(4),
    },
];

export const PRESET_OPTIONS = [
    ...SIMPLE.map((s) => ({ value: s.id, label: s.label })),
    { value: 'moebius', label: 'Möbius (3 points → 3 targets)' },
    { value: 'poly', label: 'polynomial with draggable roots' },
    { value: 'custom', label: 'formula f(z) …' },
];

const SIMPLE_BY_ID = Object.fromEntries(SIMPLE.map((s) => [s.id, s]));

/** Initial draggable parameters (fresh copy each call). */
export function defaultParams() {
    return {
        mob: {
            z: [[-1, 0], [0, 1], [1, 0]],
            w: [[0, -1], [1, 0], [0, 1]],
        },
        roots: [[-1, 0], [1, 0.2], [0, 1], [0, -1], [0.5, -0.8]],
        jc: [-0.15, 0.15], // centre of the Joukowski circle
    };
}

/** Default views { dv, iv } for a preset. */
export function presetViews(id) {
    const s = SIMPLE_BY_ID[id];
    if (s) return { dv: { ...s.dv }, iv: { ...s.iv } };
    if (id === 'poly') return { dv: sym(2), iv: sym(6) };
    return { dv: sym(3), iv: sym(4) };
}

const FAIL = [NaN, NaN];
const fix = (z) => (Array.isArray(z) && Number.isFinite(z[0]) && Number.isFinite(z[1]) ? z : FAIL);

function fromDef(id, def, view, extra = {}) {
    return {
        id,
        f: (z) => {
            try { return fix(def(complexAlg, z)); } catch { return FAIL; }
        },
        df: (z) => derivative(def, z),
        critical: [],
        special: [],
        cut: false,
        ...extra,
    };
}

/**
 * Build the map for a preset. `view` is the domain view (for periodic critical points), `params` from
 * defaultParams(), `n` the number of polynomial roots, `parse` an optional parseExpression(str).
 * Returns { map, error }; map.sig is a string that changes whenever the map does.
 */
export function buildMap(id, view, params, { n = 3, expr = '', parse = null } = {}) {
    const s = SIMPLE_BY_ID[id];
    if (s) {
        const map = fromDef(id, s.def, view, {
            critical: s.critical ? s.critical(view) : [],
            special: s.special ? s.special(view) : [],
            cut: !!s.cut,
        });
        map.sig = id;
        return { map, error: null };
    }
    if (id === 'moebius') {
        const m = moebiusFrom3(params.mob.z, params.mob.w);
        const sig = `moebius${JSON.stringify(params.mob)}`;
        if (!m) {
            return { map: { id, f: (z) => z, df: () => [1, 0], critical: [], special: [], cut: false, sig, moebius: null }, error: 'points must be distinct' };
        }
        return {
            map: {
                id, sig, moebius: m, critical: [], special: [], cut: false,
                f: (z) => fix(applyMoebius(m, z)),
                df: (z) => fix(moebiusDerivative(m, z)),
            },
            error: null,
        };
    }
    if (id === 'poly') {
        const roots = params.roots.slice(0, Math.max(1, Math.min(5, n)));
        const coef = polyFromRoots(roots);
        return {
            map: {
                id, roots, sig: `poly${JSON.stringify(roots)}`, critical: roots.length > 1 ? criticalPoints(roots) : [], special: [], cut: false,
                f: (z) => evalPoly(coef, z).p,
                df: (z) => evalPoly(coef, z).dp,
            },
            error: null,
        };
    }
    // custom formula in z, parsed by lib/expr.js (whose variable is called x)
    let def = null;
    let error = null;
    try {
        if (!parse) throw new Error('expression parser unavailable');
        def = parse(String(expr).replace(/\bz\b/g, 'x'));
        def(complexAlg, [0.5, 0.5]);
    } catch (e) {
        error = String(e.message || e);
        def = (A, x) => x;
    }
    return { map: fromDef('custom', def, view, { sig: `custom:${expr}` }), error };
}
