// State helpers for the Monge sketch: defaults, presets, randomisation, animation, hit testing.

export const DEFAULTS = {
    showExternal: true,
    showInternal: false,
    showTangentPoints: true,
    showCones: true,
    showInternalPts: false,
    showExtra: false,
    showGrid: true,
    snap: false,
    proof: false,
    proofStep: 1,
    animate: false,
    speed: 1,
};

export const PROOF_STEPS = 4;
export const SNAP = 0.5;
export const MIN_R = 0.1;
export const MAX_R = 1e4;
export const MAX_COORD = 1e6;
/** Angle (radians, maths orientation) of the radius handle on every circle. */
export const HANDLE_ANGLE = Math.PI / 4;
const HIT_HANDLE = 12;
const HIT_CENTER = 14;

export const DEFAULT_VIEW = { xmin: -10, xmax: 10, ymin: -6, ymax: 6 };

/** Three circles tangent to each other pairwise (radii 2, 1.5, 1). */
function touchingTriple() {
    const [r1, r2, r3] = [2, 1.5, 1];
    const d12 = r1 + r2, d13 = r1 + r3, d23 = r2 + r3;
    const x = (d13 * d13 - d23 * d23 + d12 * d12) / (2 * d12);
    const y = Math.sqrt(Math.max(0, d13 * d13 - x * x));
    const ox = -5, oy = -2;
    return [
        { x: ox, y: oy, r: r1 },
        { x: ox + d12, y: oy, r: r2 },
        { x: ox + x, y: oy + y, r: r3 },
    ];
}

export const PRESETS = {
    generic: () => [
        { x: -5, y: -1, r: 2.2 },
        { x: 2.5, y: 2, r: 1.2 },
        { x: 3.5, y: -1.8, r: 2.8 },
    ],
    equal: () => [
        { x: -5, y: -1.5, r: 1.8 },
        { x: 1.5, y: 2.5, r: 1.8 },
        { x: 4.5, y: -2.5, r: 1.8 },
    ],
    nested: () => [
        { x: 0, y: 0, r: 5 },
        { x: 1.2, y: 0.5, r: 2.4 },
        { x: -2.2, y: -1.2, r: 1.3 },
    ],
    touching: touchingTriple,
    symmetric: () => [
        { x: -4.5, y: -2, r: 2 },
        { x: 4.5, y: -2, r: 2 },
        { x: 0, y: 2.2, r: 3 },
    ],
};

export const PRESET_LABELS = {
    generic: 'Generic',
    equal: 'Equal radii (points at infinity)',
    nested: 'Nested',
    touching: 'Touching',
    symmetric: 'Symmetric',
};

export const cloneCircles = (cs) => cs.map((c) => ({ x: c.x, y: c.y, r: c.r }));

/** Random circles inside the given world rectangle; radii are kept apart so no exsimilicenter is at infinity. */
export function randomCircles(view, rnd = Math.random) {
    const w = view.xmax - view.xmin, h = view.ymax - view.ymin;
    const base = Math.min(w, h);
    const out = [];
    let guard = 0;
    while (out.length < 3 && guard++ < 200) {
        const c = {
            x: view.xmin + w * (0.15 + 0.7 * rnd()),
            y: view.ymin + h * (0.2 + 0.6 * rnd()),
            r: base * (0.06 + 0.16 * rnd()),
        };
        if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) > 0.3 * base && Math.abs(o.r - c.r) > 0.03 * base)) out.push(c);
    }
    while (out.length < 3) out.push({ x: view.xmin + w * (0.3 + 0.2 * out.length), y: view.ymin + h / 2, r: base * (0.08 + 0.05 * out.length) });
    return out;
}

/** Lissajous drift offset of circle i at phase t (world units). */
export function animOffset(i, t, amp = 1.6) {
    const f = [[1.0, 1.3], [1.7, 0.9], [0.8, 1.9]][i % 3];
    const ph = [0, 2.1, 4.2][i % 3];
    return [amp * Math.sin(f[0] * t + ph), amp * Math.cos(f[1] * t + ph * 0.7)];
}

const finiteOr = (v, d) => (Number.isFinite(v) ? v : d);

/** Clamp a circle into sane numeric bounds (mutates and returns it). */
export function sanitize(c) {
    c.x = Math.max(-MAX_COORD, Math.min(MAX_COORD, finiteOr(c.x, 0)));
    c.y = Math.max(-MAX_COORD, Math.min(MAX_COORD, finiteOr(c.y, 0)));
    c.r = Math.max(MIN_R, Math.min(MAX_R, finiteOr(c.r, 1)));
    return c;
}

export const snapTo = (v, step = SNAP) => Math.round(v / step) * step;

/** Screen position of the radius handle of circle c. */
export function handlePos(view, c) {
    return [view.toX(c.x + c.r * Math.cos(HANDLE_ANGLE)), view.toY(c.y + c.r * Math.sin(HANDLE_ANGLE))];
}

/**
 * Hit testing with priority: radius handle, then centre dot, then circle interior.
 * Returns { kind: 'handle' | 'center' | 'body', i } or null. Later circles win ties (drawn on top).
 */
export function hitTest(circles, view, mx, my) {
    for (let i = circles.length - 1; i >= 0; i--) {
        const [hx, hy] = handlePos(view, circles[i]);
        if (Math.hypot(mx - hx, my - hy) <= HIT_HANDLE) return { kind: 'handle', i };
    }
    let best = -1, bestD = Infinity;
    for (let i = circles.length - 1; i >= 0; i--) {
        const d = Math.hypot(mx - view.toX(circles[i].x), my - view.toY(circles[i].y));
        if (d <= HIT_CENTER && d < bestD) { best = i; bestD = d; }
    }
    if (best >= 0) return { kind: 'center', i: best };
    best = -1; bestD = Infinity;
    for (let i = circles.length - 1; i >= 0; i--) {
        const c = circles[i];
        const wx = view.fromX(mx), wy = view.fromY(my);
        const d = Math.hypot(wx - c.x, wy - c.y);
        if (d <= c.r && d < bestD) { best = i; bestD = d; }
    }
    return best >= 0 ? { kind: 'body', i: best } : null;
}

export const PROOF_TEXT = [
    {
        title: '1  Homothety centres',
        text: 'Two circles with different radii are related by a homothety (a scaling) with a positive ratio r2/r1. Its centre is the point where the two external common tangents cross. Do this for all three pairs: E12, E13, E23.',
    },
    {
        title: '2  Lift the circles to spheres',
        text: 'Replace each circle by the sphere of the same radius centred in the plane z = 0. The external tangents of a pair become the silhouette of a cone touching both spheres, and E is the apex of that cone, still in z = 0.',
    },
    {
        title: '3  A plane touching all three spheres',
        text: 'Lay a plane on top of the three spheres, touching each one. It touches both spheres of a pair, so it contains the cone apex E of that pair. Hence E12, E13 and E23 all lie in this single plane.',
    },
    {
        title: '4  The plane meets z = 0 in a line',
        text: 'The three points lie in the plane z = 0 and in the tangent plane. Two different planes meet in a line, so E12, E13, E23 are collinear: that line is the Monge line.',
    },
];
