// State helpers for the Poncelet sketch: defaults, presets, randomisation, sanitising, hit testing.

import { ellipsePoint, ellipseAngle, solveClosure, innerInside } from '../../lib/conics.js';

export const DEFAULTS = {
    steps: 12,
    closeN: 5,
    closeM: 1,
    fixParam: 'scale',
    outerCircle: true,
    innerCircle: true,
    stepColors: true,
    showTouch: true,
    showEnvelope: true,
    family: false,
    showCayley: true,
    showEuler: true,
    showGrid: true,
    snap: false,
    animate: false,
    speed: 1,
};

export const DEFAULT_VIEW = { xmin: -9, xmax: 9, ymin: -5.5, ymax: 5.5 };
export const MIN_R = 0.1;
export const MAX_R = 1e4;
export const MAX_COORD = 1e6;
export const SNAP = 0.25;
const SNAP_ANGLE = Math.PI / 12;
const HIT_P0 = 13;
const HIT_HANDLE = 12;
const HIT_CENTRE = 14;

const finiteOr = (v, d) => (Number.isFinite(v) ? v : d);
export const snapTo = (v, step = SNAP) => Math.round(v / step) * step;
export const snapAngle = (a) => Math.round(a / SNAP_ANGLE) * SNAP_ANGLE;

/** Clamp an ellipse into sane bounds (mutates and returns it). A circle flag forces b = a, rot = 0. */
export function sanitize(e, circle = false) {
    e.cx = Math.max(-MAX_COORD, Math.min(MAX_COORD, finiteOr(e.cx, 0)));
    e.cy = Math.max(-MAX_COORD, Math.min(MAX_COORD, finiteOr(e.cy, 0)));
    e.a = Math.max(MIN_R, Math.min(MAX_R, finiteOr(e.a, 1)));
    e.b = Math.max(MIN_R, Math.min(MAX_R, finiteOr(e.b, e.a)));
    e.rot = finiteOr(e.rot, 0);
    if (circle) { e.b = e.a; e.rot = 0; }
    return e;
}

export const cloneE = (e) => ({ cx: e.cx, cy: e.cy, a: e.a, b: e.b, rot: e.rot || 0 });

/** Handle positions (world) of an ellipse: ellipse -> [A on the major axis, B on the minor axis]; circle -> [A at 45 deg]. */
export function handleWorld(e, circle) {
    if (circle) {
        const t = Math.PI / 4;
        return [[e.cx + e.a * Math.cos(t), e.cy + e.a * Math.sin(t)]];
    }
    const c = Math.cos(e.rot), s = Math.sin(e.rot);
    return [[e.cx + e.a * c, e.cy + e.a * s], [e.cx - e.b * s, e.cy + e.b * c]];
}

/**
 * Hit testing, priority: P0, handles (inner first), centres (inner first). Returns
 * { kind: 'p0' | 'handle' | 'centre', which: 'inner' | 'outer', h?: index } or null.
 */
export function hitTest(st, view, mx, my) {
    const d = (wx, wy) => Math.hypot(mx - view.toX(wx), my - view.toY(wy));
    const P0 = ellipsePoint(st.outer, st.t0);
    if (d(P0[0], P0[1]) <= HIT_P0) return { kind: 'p0' };
    for (const which of ['inner', 'outer']) {
        const e = st[which];
        const hs = handleWorld(e, st[which + 'Circle']);
        for (let h = 0; h < hs.length; h++) if (d(hs[h][0], hs[h][1]) <= HIT_HANDLE) return { kind: 'handle', which, h };
    }
    for (const which of ['inner', 'outer']) {
        if (d(st[which].cx, st[which].cy) <= HIT_CENTRE) return { kind: 'centre', which };
    }
    return null;
}

/** Apply a handle drag at world point (wx, wy). */
export function dragHandle(e, circle, h, wx, wy, snap) {
    const dx = wx - e.cx, dy = wy - e.cy;
    if (circle) {
        let r = Math.hypot(dx, dy);
        if (snap) r = Math.max(SNAP * 2, snapTo(r));
        e.a = e.b = Math.max(MIN_R, r);
        return;
    }
    if (h === 0) {
        let r = Math.hypot(dx, dy), rot = Math.atan2(dy, dx);
        if (snap) { r = Math.max(SNAP * 2, snapTo(r)); rot = snapAngle(rot); }
        if (r > 1e-9) { e.a = Math.max(MIN_R, r); e.rot = rot; }
    } else {
        // distance along the minor axis direction
        let r = Math.abs(-Math.sin(e.rot) * dx + Math.cos(e.rot) * dy);
        if (snap) r = Math.max(SNAP * 2, snapTo(r));
        e.b = Math.max(MIN_R, r);
    }
}

/** Move P0 to the point of the outer ellipse nearest in angle to the world point. */
export function dragP0(st, wx, wy, snap) {
    const t = ellipseAngle(st.outer, wx, wy);
    st.t0 = snap ? snapAngle(t) : t;
}

// ---------- presets ----------

function build(outer, inner, n, m, circles, param = 'scale') {
    const s = solveClosure(outer, inner, { n, m, param, t0: 0.3 });
    return {
        outer: cloneE(outer), inner: cloneE(s.ok ? s.inner : inner), t0: 0.3,
        outerCircle: circles[0], innerCircle: circles[1], steps: n, closeN: n, closeM: m,
    };
}

const C4 = { cx: 0, cy: 0, a: 4, b: 4, rot: 0 };

export const PRESETS = {
    triangle: () => {
        // Euler: d^2 = R^2 - 2 R r
        const R = 4, d = 1.5;
        return {
            outer: cloneE(C4), inner: { cx: d, cy: 0, a: (R * R - d * d) / (2 * R), b: (R * R - d * d) / (2 * R), rot: 0 },
            t0: 0.3, outerCircle: true, innerCircle: true, steps: 3, closeN: 3, closeM: 1,
        };
    },
    square: () => build(C4, { cx: 1, cy: 0.4, a: 1.5, b: 1.5, rot: 0 }, 4, 1, [true, true]),
    pentagon: () => build(C4, { cx: -1.2, cy: 0.6, a: 1.5, b: 1.5, rot: 0 }, 5, 1, [true, true]),
    star: () => build(C4, { cx: 0.8, cy: -0.5, a: 1.5, b: 1.5, rot: 0 }, 5, 2, [true, true]),
    ellipses: () => build({ cx: 0, cy: 0, a: 5.5, b: 3.6, rot: 0.25 }, { cx: 0.5, cy: 0.2, a: 1.6, b: 1.6, rot: 0 }, 6, 1, [false, true]),
    nonclosing: () => ({
        outer: cloneE(C4), inner: { cx: 1, cy: 0.3, a: 1.3, b: 1.3, rot: 0 },
        t0: 0.3, outerCircle: true, innerCircle: true, steps: 24, closeN: 5, closeM: 1,
    }),
};

export const PRESET_LABELS = {
    triangle: 'Triangle (Euler)',
    square: 'Square',
    pentagon: 'Pentagon',
    star: 'Pentagram (winding 2)',
    ellipses: 'Hexagon, ellipse + circle',
    nonclosing: 'Non-closing pair',
};

/** Random pair with the inner ellipse inside the outer one. */
export function randomPair(rnd = Math.random) {
    for (let k = 0; k < 200; k++) {
        const a = 3.5 + 2 * rnd();
        const outerCircle = rnd() < 0.5, innerCircle = rnd() < 0.5;
        const outer = sanitize({ cx: (rnd() - 0.5) * 2, cy: (rnd() - 0.5) * 1.2, a, b: a * (0.65 + 0.35 * rnd()), rot: rnd() * Math.PI }, outerCircle);
        const ia = a * (0.2 + 0.25 * rnd());
        const inner = sanitize({
            cx: outer.cx + (rnd() - 0.5) * a * 0.7, cy: outer.cy + (rnd() - 0.5) * a * 0.5,
            a: ia, b: ia * (0.6 + 0.4 * rnd()), rot: rnd() * Math.PI,
        }, innerCircle);
        if (innerInside(outer, inner)) return { outer, inner, outerCircle, innerCircle, t0: rnd() * 2 * Math.PI };
    }
    return { ...PRESETS.nonclosing() };
}
