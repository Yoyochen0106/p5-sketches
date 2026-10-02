// Defaults, presets and constants for the Elliptic Curve Group sketch.

export const DEFAULTS = {
    tab: 'real',
    // real curve y^2 = x^3 + a x + b
    a: -2,
    b: 1,
    manual: false,
    stage: 4,
    speed: 1,
    trailN: 0,
    show2torsion: true,
    showGrid: true,
    // finite field
    p: 97,
    fa: 2,
    fb: 3,
    ffMirror: true,
    ffMults: true,
    ffArrows: true,
    ffWrap: true,
    guess: 2,
    // complex torus
    tauRe: 0,
    tauIm: 1,
    torusReal: true,
};

export const TABS = [
    { value: 'real', label: 'Real' },
    { value: 'finite', label: 'F_p' },
    { value: 'torus', label: 'Torus' },
];

/** Primes offered for the finite-field tab (all >= 5 so the short Weierstrass form is valid). */
export const PRIMES = [5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 61, 71, 83, 97, 127, 167, 223, 251, 509, 997, 1499, 1999];

export const AB_RANGE = 4;
export const MAX_TRAIL = 24;
export const STAGES = 4;

export const REAL_VIEW = { xmin: -4.2, xmax: 6.2, ymin: -4, ymax: 4 };

/** Real-tab presets: curve plus starting points (snapped to the curve by the sketch). */
export const REAL_PRESETS = {
    generic: { label: 'Two components (a = -2, b = 1)', a: -2, b: 1, P: [-1.2, 1.2], Q: [1.8, -1.7] },
    secp: { label: 'secp-like: y² = x³ + 7', a: 0, b: 7, P: [1, 2.8], Q: [3, 5.8], trail: 0 },
    xx: { label: 'y² = x³ − x (torsion Z2 × Z2)', a: -1, b: 0, P: [-1, 0], Q: [0, 0] },
    cube1: { label: 'y² = x³ + 1 (order-6 point (2,3))', a: 0, b: 1, P: [2, 3], Q: [2, 3], trail: 6 },
    cusp: { label: 'Cusp: y² = x³', a: 0, b: 0, P: [1.2, 1.3], Q: [2.5, -3.9] },
    node: { label: 'Node: y² = x³ − 3x + 2', a: -3, b: 2, P: [2.5, 3], Q: [-1.5, 1] },
};

/** Finite-field presets. P is optional (defaults to a point a third of the way through the list). */
export const FINITE_PRESETS = {
    secp: { label: 'secp-like: y² = x³ + 7 over F_223', p: 223, a: 0, b: 7, P: [47, 71] },
    cyclic: { label: 'Cyclic: y² = x³ + 2x + 2 over F_17 (#E = 19)', p: 17, a: 2, b: 2 },
    xx: { label: 'y² = x³ − x over F_13 (full 2-torsion)', p: 13, a: 12, b: 0 },
    cube1: { label: 'y² = x³ + 1 over F_11', p: 11, a: 0, b: 1 },
    big: { label: 'Large: y² = x³ + 3x + 8 over F_1999', p: 1999, a: 3, b: 8 },
};

export const TORUS_PRESETS = {
    square: { label: 'Square lattice (τ = i, g3 = 0)', re: 0, im: 1 },
    hex: { label: 'Hexagonal lattice (g2 = 0)', re: 0.5, im: Math.sqrt(3) / 2 },
    rect: { label: 'Rectangular, τ = 1.6 i', re: 0, im: 1.6 },
    oblique: { label: 'Oblique, τ = 0.23 + 0.9 i', re: 0.23, im: 0.9 },
};

/** Clamp helper. */
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Deterministic-friendly random integer in [lo, hi]. */
export const randInt = (lo, hi, rnd = Math.random) => lo + Math.floor(rnd() * (hi - lo + 1));
